import { fileURLToPath } from 'node:url';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './connection';
import { migrateJobs } from './jobs';

/** The versioned SQL migrations, oldest first (ADR-0008 §9, CODE-16). */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Brings the database up to the latest migration, those already run skipped, and then pg-boss's
 * tables and queues (ADR-0008 §10, clarification).
 */
export async function migrate(db: Database) {
  await run(db, { migrationsFolder });
  await migrateJobs(db);
}
