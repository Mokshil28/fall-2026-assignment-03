import { Router } from 'express';
import { createUser, getAllUsers, getUserById } from '../dal/users.js';
import authMiddleware from '../middleware/auth.js';
import { isRequiredText, parseInteger } from './validation.js';

const router = Router();

// Part 1: use the supplied DAL for queries. Forward async failures with next(error)
// because Express 4 does not automatically catch rejected promises.
router.get('/', async (_req, res, next) => {
  try {
    res.json(await getAllUsers());
  } catch (error) {
    next(error);
  }
});

// Malformed IDs return 400; valid IDs without a matching user return 404.
router.get('/:id', async (req, res, next) => {
  const id = parseInteger(req.params.id, 1);
  if (id === undefined) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }
  try {
    const user = await getUserById(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Header validation also applies when creating the first user; it checks the ID
// format without requiring that the header identify an existing account.
router.post('/', authMiddleware, async (req, res, next) => {
  const { name, email } = req.body ?? {};
  if (
    !isRequiredText(name) ||
    !isRequiredText(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400).json({ error: 'A name and valid email are required' });
    return;
  }
  try {
    res.status(201).json(await createUser({ name: name.trim(), email }));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      // PostgreSQL unique violation: the email is already registered.
      error.code === '23505'
    ) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }
    next(error);
  }
});

export default router;
