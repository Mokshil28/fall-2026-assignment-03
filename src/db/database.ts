import {
  Kysely,
  PostgresDialect,
  Generated,
  Selectable,
  Insertable,
  Updateable,
  ColumnType,
} from 'kysely';
import pg from 'pg';

const { Pool } = pg;

export interface UsersTable {
  id: Generated<number>;
  name: string;
  email: string;
  created_at: Generated<Date>;
}

export interface TicketsTable {
  id: Generated<number>;
  title: string;
  description: string | null;
  status: Generated<string>;
  creator_id: number;
  assignee_id: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TimeLogsTable {
  id: Generated<number>;
  ticket_id: number;
  user_id: number;
  // pg reads numeric columns as strings; writes accept JavaScript numbers.
  hours: ColumnType<string, number, number>;
  logged_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  tickets: TicketsTable;
  time_logs: TimeLogsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Ticket = Selectable<TicketsTable>;
export type NewTicket = Insertable<TicketsTable>;
export type TicketUpdate = Updateable<TicketsTable>;

// The DAL converts hours to a number before returning the row to API callers.
export type TimeLog = Omit<Selectable<TimeLogsTable>, 'hours'> & {
  hours: number;
};
export type NewTimeLog = Insertable<TimeLogsTable>;

/**
 * Creates and returns a new Kysely database instance.
 * Allows passing an explicit connection URL for testing or custom environments.
 */
export function createDatabase(connectionString?: string): Kysely<Database> {
  const url =
    connectionString ||
    (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL ||
        'postgres://postgres:postgres@localhost:5432/issue_tracker');

  const pool = new Pool({
    connectionString: url,
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
  });
}

// Default application database instance
export let db = createDatabase();

/**
 * Replaces the active database instance (e.g. for testing with an alternative database connection)
 */
export function setDatabase(newDb: Kysely<Database>): void {
  db = newDb;
}
