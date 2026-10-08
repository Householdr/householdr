import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './connection';
import { migrateJobs } from './jobs';

/** The versioned SQL migrations, oldest first (ADR-0008 §9, CODE-16). */
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** The tables whose rows the app adds and reads, but never changes or deletes. */
const appendOnly = [
  // The activity log can't be edited or deleted by anyone in the household (ADR-0018 §5).
  'activity_log',
];

/**
 * Brings the database up to the latest migration, those already run skipped, and then pg-boss's
 * tables and queues (ADR-0008 §10, clarification). It runs as the owner of the tables, and lets
 * `appRole`, the role the app and the worker connect as, read and write their data and nothing
 * more (ADR-0008 §9, clarification): of an append-only table, only read and add.
 */
export async function migrate(db: Database, appRole: string) {
  await run(db, { migrationsFolder });
  await migrateJobs(db);
  const app = sql.identifier(appRole);
  for (const name of ['public', 'auth', 'pgboss']) {
    const schema = sql.identifier(name);
    await db.execute(sql`grant usage on schema ${schema} to ${app}`);
    await db.execute(
      sql`grant select, insert, update, delete on all tables in schema ${schema} to ${app}`,
    );
    await db.execute(sql`grant usage, select on all sequences in schema ${schema} to ${app}`);
    await db.execute(sql`grant execute on all functions in schema ${schema} to ${app}`);
  }
  for (const table of appendOnly) {
    await db.execute(sql`revoke update, delete on ${sql.identifier(table)} from ${app}`);
  }
}
