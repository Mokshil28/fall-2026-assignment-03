import { db, TimeLog } from '../db/database.js';

// Part 2: return the persisted row, including its generated ID and timestamp.
export async function insertTimeLog(
  ticketId: number,
  userId: number,
  hours: number,
): Promise<TimeLog> {
  const log = await db
    .insertInto('time_logs')
    .values({ ticket_id: ticketId, user_id: userId, hours })
    .returningAll()
    .executeTakeFirstOrThrow();
  // PostgreSQL numeric values are returned as strings by pg.
  return { ...log, hours: Number(log.hours) };
}

export async function getTotalHoursForTicket(
  ticketId: number,
): Promise<number> {
  // Sum in PostgreSQL instead of fetching rows to add them in JavaScript.
  const result = await db
    .selectFrom('time_logs')
    .select((eb) => eb.fn.sum<string | null>('hours').as('total_hours'))
    .where('ticket_id', '=', ticketId)
    .executeTakeFirstOrThrow();
  // SUM returns null for no rows; convert numeric text to an API number.
  return Number(result.total_hours ?? 0);
}
