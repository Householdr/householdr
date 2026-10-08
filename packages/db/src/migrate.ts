import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './connection';
import { migrateJobs } from './jobs';

/** The versioned SQL migrations, oldest first (ADR-0008 §9, CODE-16). */
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Brings the database up to the latest migration, those already run skipped, and then pg-boss's
 * tables and queues (ADR-0008 §10, clarification). It runs as the owner of the tables, and lets
 * `appRole`, the role the app and the worker connect as, read and write their data and nothing
 * more (ADR-0008 §9, clarification).
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
}
