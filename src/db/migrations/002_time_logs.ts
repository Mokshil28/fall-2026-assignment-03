import { Kysely, sql } from 'kysely';

// Part 2: numeric supports fractional hours. Foreign keys prevent orphan logs;
// cascading deletes remove logs when their referenced ticket or user is removed.
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('time_logs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('ticket_id', 'integer', (col) =>
      col.references('tickets.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('hours', 'numeric', (col) => col.notNull())
    .addColumn('logged_at', 'timestamptz', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    // Enforce positive, finite hours even when callers bypass HTTP validation.
    .addCheckConstraint(
      'time_logs_positive_finite_hours',
      sql`hours > 0 AND hours < 'Infinity'::numeric`,
    )
    .execute();
}

// Roll back this table only, preserving the users and tickets tables.
export async function down<DB>(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('time_logs').execute();
}
