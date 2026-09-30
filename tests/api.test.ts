import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

// Part 1: Supertest exercises Express and PostgreSQL together. The shared setup
// clears the selected database before each test, so use TEST_DATABASE_URL.
async function createUser() {
  const response = await request(app)
    .post('/users')
    .set('X-User-Id', '1')
    .send({ name: 'Alice', email: 'alice@example.com' })
    .expect(201);
  return response.body;
}

async function createTicket(userId: number, title = 'Fix login') {
  const response = await request(app)
    .post('/tickets')
    .set('X-User-Id', String(userId))
    .send({ title, description: 'Login fails', creator_id: 999 })
    .expect(201);
  return response.body;
}

describe('Part 1: API Integration Tests', () => {
  it('lists users without authentication and creates and retrieves a user', async () => {
    expect((await request(app).get('/users').expect(200)).body).toEqual([]);
    const user = await createUser();
    expect(user).toMatchObject({
      id: expect.any(Number),
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(
      (await request(app).get(`/users/${user.id}`).expect(200)).body,
    ).toEqual(user);
    expect((await request(app).get('/users').expect(200)).body).toEqual([user]);
  });

  it.each(['/users/999', '/tickets/999'])(
    'returns 404 for missing record %s',
    async (path) => {
      await request(app).get(path).expect(404);
    },
  );

  it.each(['abc', '0', '-1', '1.5', '2147483648'])(
    'rejects invalid resource ID %s',
    async (id) => {
      await request(app).get(`/users/${id}`).expect(400);
      await request(app).get(`/tickets/${id}`).expect(400);
    },
  );

  it.each([
    undefined,
    'abc',
    '0',
    '-1',
    '1.5',
    'Infinity',
    '1e2',
    '2147483648',
  ])(
    'rejects invalid authentication %s on all write routes',
    async (header) => {
      for (const [method, path] of [
        ['post', '/users'],
        ['post', '/tickets'],
        ['patch', '/tickets/1/status'],
      ] as const) {
        const call = request(app)[method](path);
        if (header !== undefined) call.set('X-User-Id', header);
        await call.send({}).expect(401);
      }
    },
  );

  it.each([
    {},
    { name: '', email: 'alice@example.com' },
    { name: 'Alice', email: 'invalid' },
    { name: 42, email: 'alice@example.com' },
    { name: 'a'.repeat(256), email: 'alice@example.com' },
  ])('rejects invalid user payload %j', async (body) => {
    await request(app)
      .post('/users')
      .set('X-User-Id', '1')
      .send(body)
      .expect(400);
  });

  it('returns 409 for a duplicate email', async () => {
    await createUser();
    await request(app)
      .post('/users')
      .set('X-User-Id', '1')
      .send({ name: 'Another user', email: 'alice@example.com' })
      .expect(409);
  });

  it('creates a ticket using the header identity and retrieves it', async () => {
    const user = await createUser();
    const ticket = await createTicket(user.id);
    expect(ticket).toMatchObject({
      title: 'Fix login',
      description: 'Login fails',
      status: 'TODO',
      creator_id: user.id,
    });
    expect(
      (await request(app).get(`/tickets/${ticket.id}`).expect(200)).body,
    ).toEqual(ticket);
    expect((await request(app).get('/tickets').expect(200)).body).toEqual([
      ticket,
    ]);
  });

  it('allows an omitted description', async () => {
    const user = await createUser();
    const response = await request(app)
      .post('/tickets')
      .set('X-User-Id', String(user.id))
      .send({ title: 'Task' })
      .expect(201);
    expect(response.body.description).toBeNull();
  });

  it.each([
    {},
    { title: ' ' },
    { title: 12 },
    { title: 'a'.repeat(256) },
    { title: 'Task', description: 42 },
  ])('rejects invalid ticket payload %j', async (body) => {
    await request(app)
      .post('/tickets')
      .set('X-User-Id', '1')
      .send(body)
      .expect(400);
  });

  it('rejects a nonexistent ticket creator', async () => {
    await request(app)
      .post('/tickets')
      .set('X-User-Id', '999')
      .send({ title: 'Task' })
      .expect(400);
  });

  it('updates ticket status and persists the change', async () => {
    const user = await createUser();
    const ticket = await createTicket(user.id);
    for (const status of ['IN_PROGRESS', 'DONE', 'TODO']) {
      const response = await request(app)
        .patch(`/tickets/${ticket.id}/status`)
        .set('X-User-Id', String(user.id))
        .send({ status })
        .expect(200);
      expect(response.body.status).toBe(status);
      expect(
        (await request(app).get(`/tickets/${ticket.id}`).expect(200)).body
          .status,
      ).toBe(status);
    }
  });

  it('handles missing tickets and invalid status updates', async () => {
    await request(app)
      .patch('/tickets/999/status')
      .set('X-User-Id', '1')
      .send({ status: 'DONE' })
      .expect(404);
    for (const status of ['INVALID', '', 123, null]) {
      await request(app)
        .patch('/tickets/999/status')
        .set('X-User-Id', '1')
        .send({ status })
        .expect(400);
    }
    await request(app)
      .patch('/tickets/abc/status')
      .set('X-User-Id', '1')
      .send({ status: 'DONE' })
      .expect(400);
  });

  it('filters before paginating, with stable ordering and empty pages', async () => {
    const user = await createUser();
    const first = await createTicket(user.id, 'First');
    const second = await createTicket(user.id, 'Second');
    const third = await createTicket(user.id, 'Third');
    await request(app)
      .patch(`/tickets/${second.id}/status`)
      .set('X-User-Id', String(user.id))
      .send({ status: 'DONE' })
      .expect(200);
    expect(
      (
        await request(app).get('/tickets?limit=1&offset=1').expect(200)
      ).body.map((t: { id: number }) => t.id),
    ).toEqual([second.id]);
    expect(
      (await request(app).get('/tickets?status=TODO').expect(200)).body.map(
        (t: { id: number }) => t.id,
      ),
    ).toEqual([first.id, third.id]);
    expect(
      (
        await request(app)
          .get('/tickets?status=TODO&limit=1&offset=1')
          .expect(200)
      ).body.map((t: { id: number }) => t.id),
    ).toEqual([third.id]);
    expect(
      (await request(app).get('/tickets?offset=100').expect(200)).body,
    ).toEqual([]);
    expect(
      (await request(app).get('/tickets?limit=0').expect(200)).body,
    ).toEqual([]);
  });

  it.each([
    'limit=-1',
    'limit=1.5',
    'limit=abc',
    'limit=',
    'offset=-1',
    'offset=1x',
    'status=INVALID',
    'limit=1&limit=2',
    'status=TODO&status=DONE',
    'limit=99999999999999999999',
  ])('rejects invalid query %s', async (query) => {
    await request(app).get(`/tickets?${query}`).expect(400);
  });
});
