import { Router } from 'express';
import {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicketStatus,
} from '../dal/tickets.js';
import authMiddleware from '../middleware/auth.js';
import { getUserById } from '../dal/users.js';
import { insertTimeLog, getTotalHoursForTicket } from '../dal/timeLogs.js';
import { isRequiredText, isStatus, parseInteger } from './validation.js';

const router = Router();

// Part 1: validate query strings before the DAL applies filtering and pagination
// in SQL, with stable ordering by ticket ID.
router.get('/', async (req, res, next) => {
  const limit =
    req.query.limit === undefined ? undefined : parseInteger(req.query.limit);
  const offset =
    req.query.offset === undefined ? undefined : parseInteger(req.query.offset);
  const status = req.query.status;
  if (
    (req.query.limit !== undefined && limit === undefined) ||
    (req.query.offset !== undefined && offset === undefined) ||
    (status !== undefined && !isStatus(status))
  ) {
    res.status(400).json({ error: 'Invalid pagination or status filter' });
    return;
  }
  try {
    res.json(await getAllTickets({ limit, offset, status }));
  } catch (error) {
    next(error);
  }
});

// Distinguish malformed IDs (400) from missing tickets (404).
router.get('/:id', async (req, res, next) => {
  const id = parseInteger(req.params.id, 1);
  if (id === undefined) {
    res.status(400).json({ error: 'Invalid ticket ID' });
    return;
  }
  try {
    const ticket = await getTicketById(id);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

// Only accepted fields reach the DAL; creator identity comes from middleware.
router.post('/', authMiddleware, async (req, res, next) => {
  const { title, description } = req.body ?? {};
  if (
    !isRequiredText(title) ||
    (description !== undefined &&
      description !== null &&
      typeof description !== 'string')
  ) {
    res
      .status(400)
      .json({ error: 'A title and optional text description are required' });
    return;
  }
  try {
    res.status(201).json(
      await createTicket({
        title: title.trim(),
        description: description ?? null,
        creator_id: res.locals.userId,
      }),
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23503'
    ) {
      res.status(400).json({ error: 'Creator does not exist' });
      return;
    }
    next(error);
  }
});

// The DAL updates both the status and the modification timestamp.
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  const id = parseInteger(req.params.id, 1);
  const status = req.body?.status;
  if (id === undefined || !isStatus(status)) {
    res
      .status(400)
      .json({ error: 'A valid ticket ID and status are required' });
    return;
  }
  try {
    const ticket = await updateTicketStatus(id, status);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

// Part 2: accept positive fractional hours. The URL determines the ticket, and
// middleware determines the user; body-supplied IDs cannot override either.
router.post('/:id/time', authMiddleware, async (req, res, next) => {
  const id = parseInteger(req.params.id, 1);
  const hours = req.body?.hours;
  if (
    id === undefined ||
    typeof hours !== 'number' ||
    !Number.isFinite(hours) ||
    hours <= 0
  ) {
    res.status(400).json({
      error: 'A valid ticket ID and positive, finite hours are required',
    });
    return;
  }
  try {
    if (!(await getTicketById(id))) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (!(await getUserById(res.locals.userId))) {
      res.status(400).json({ error: 'User does not exist' });
      return;
    }
    res.status(201).json(await insertTimeLog(id, res.locals.userId, hours));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23503'
    ) {
      // A referenced record may be deleted after the existence checks above.
      res.status(400).json({ error: 'Ticket or user no longer exists' });
      return;
    }
    next(error);
  }
});

// Missing tickets return 404; existing tickets without logs return zero hours.
router.get('/:id/time', async (req, res, next) => {
  const id = parseInteger(req.params.id, 1);
  if (id === undefined) {
    res.status(400).json({ error: 'Invalid ticket ID' });
    return;
  }
  try {
    if (!(await getTicketById(id))) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json({ ticket_id: id, total_hours: await getTotalHoursForTicket(id) });
  } catch (error) {
    next(error);
  }
});

export default router;
