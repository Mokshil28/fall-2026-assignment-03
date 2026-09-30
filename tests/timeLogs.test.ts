import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { db } from '../src/db/database.js';
import { createUser } from '../src/dal/users.js';
import { createTicket } from '../src/dal/tickets.js';
import { insertTimeLog } from '../src/dal/timeLogs.js';
import { sql } from 'kysely';
import { down, up } from '../src/db/migrations/002_time_logs.js';

// Part 2: create fixtures through the DAL to isolate time-log behavior from
// user/ticket route behavior. Tests cover aggregation, validation, and rollback.
async function fixture() {
  const user = await createUser({ name: 'Alice', email: 'alice@example.com' });
  const ticket = await createTicket({ title: 'Task', creator_id: user.id });
  return { user, ticket };
}

describe('Part 2: Time Logs Tests', () => {
  it('creates logs with header identity, timestamp, and numeric hours, and sums them', async () => {
    const { user, ticket } = await fixture();
    const other = await createUser({ name: 'Bob', email: 'bob@example.com' });
    for (const [userId, hours] of [
      [user.id, 1.25],
      [other.id, 2.5],
      [user.id, 0.1],
      [user.id, 0.2],
    ]) {
      const response = await request(app)
        .post(`/tickets/${ticket.id}/time`)
        .set('X-User-Id', String(userId))
        .send({ hours, user_id: 999, ticket_id: 999 })
        .expect(201);
      expect(response.body).toMatchObject({
        id: expect.any(Number),
        ticket_id: ticket.id,
        user_id: userId,
        hours,
      });
      expect(Number.isNaN(Date.parse(response.body.logged_at))).toBe(false);
    }
    const total = await request(app)
      .get(`/tickets/${ticket.id}/time`)
      .expect(200);
    expect(total.body).toEqual({ ticket_id: ticket.id, total_hours: 4.05 });
  });

  it('returns zero for no logs and keeps totals isolated per ticket', async () => {
    const { user, ticket } = await fixture();
    const second = await createTicket({ title: 'Second', creator_id: user.id });
    await insertTimeLog(second.id, user.id, 5);
    expect(
      (await request(app).get(`/tickets/${ticket.id}/time`).expect(200)).body
        .total_hours,
    ).toBe(0);
    expect(
      (await request(app).get(`/tickets/${second.id}/time`).expect(200)).body
        .total_hours,
    ).toBe(5);
  });

  it.each([undefined, 'abc', '-1', '1.5'])(
    'rejects invalid authentication %s',
    async (header) => {
      const call = request(app).post('/tickets/1/time');
      if (header !== undefined) call.set('X-User-Id', header);
      await call.send({ hours: 1 }).expect(401);
    },
  );

  it.each([
    {},
    { hours: 0 },
    { hours: -1 },
    { hours: '2' },
    { hours: null },
    { hours: true },
    { hours: [] },
  ])('rejects invalid hours %j without inserting logs', async (body) => {
    const { user, ticket } = await fixture();
    await request(app)
      .post(`/tickets/${ticket.id}/time`)
      .set('X-User-Id', String(user.id))
      .send(body)
      .expect(400);
    expect(
      (await request(app).get(`/tickets/${ticket.id}/time`).expect(200)).body
        .total_hours,
    ).toBe(0);
  });

  it('rejects overflowing JSON numbers', async () => {
    await request(app)
      .post('/tickets/1/time')
      .set('X-User-Id', '1')
      .set('Content-Type', 'application/json')
      .send('{"hours":1e400}')
      .expect(400);
  });

  it('returns 404 for missing tickets and 400 for missing users', async () => {
    const { ticket } = await fixture();
    await request(app).get('/tickets/999/time').expect(404);
    await request(app)
      .post('/tickets/999/time')
      .set('X-User-Id', '1')
      .send({ hours: 1 })
      .expect(404);
    await request(app)
      .post(`/tickets/${ticket.id}/time`)
      .set('X-User-Id', '999')
      .send({ hours: 1 })
      .expect(400);
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'rejects invalid ticket ID %s',
    async (id) => {
      await request(app).get(`/tickets/${id}/time`).expect(400);
      await request(app)
        .post(`/tickets/${id}/time`)
        .set('X-User-Id', '1')
        .send({ hours: 1 })
        .expect(400);
    },
  );

  it('enforces database foreign keys and positive hours', async () => {
    const { user, ticket } = await fixture();
    await expect(insertTimeLog(999, user.id, 1)).rejects.toMatchObject({
      code: '23503',
    });
    await expect(insertTimeLog(ticket.id, 999, 1)).rejects.toMatchObject({
      code: '23503',
    });
    for (const hours of [0, -1, Infinity, NaN]) {
      await expect(
        insertTimeLog(ticket.id, user.id, hours),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('can roll back and recreate the table', async () => {
    await down(db);
    try {
      const result = await sql<{
        table_name: string | null;
      }>`SELECT to_regclass('public.time_logs')::text AS table_name`.execute(
        db,
      );
      expect(result.rows[0].table_name).toBeNull();
    } finally {
      await up(db);
    }
    const { user, ticket } = await fixture();
    expect(await insertTimeLog(ticket.id, user.id, 0.5)).toMatchObject({
      hours: 0.5,
    });
  });
});
