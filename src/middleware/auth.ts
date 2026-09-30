import { Request, Response, NextFunction } from 'express';

// Part 1: the assignment identifies callers by a numeric header, not a password.
// Attach this middleware only to write routes; reads remain public.
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.get('X-User-Id');
  const userId = Number(header);
  if (
    !header ||
    !/^\d+$/.test(header) ||
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    userId > 2147483647
  ) {
    res.status(401).json({ error: 'A valid X-User-Id header is required' });
    return;
  }
  // Share the validated ID with downstream handlers instead of trusting body IDs.
  res.locals.userId = userId;
  next();
}

export default authMiddleware;
