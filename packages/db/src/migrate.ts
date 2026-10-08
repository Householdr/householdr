import { fileURLToPath } from 'node:url';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './connection';

/** The versioned SQL migrations, oldest first (ADR-0008 §9, CODE-16). */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Brings the database up to the latest migration; those already run are skipped. */
export function migrate(db: Database) {
  return run(db, { migrationsFolder });
}
