import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A pool of connections to `url`, and a way to close it. Refuses a role that row-level security
 * doesn't bind (ADR-0008 §9).
 */
export async function connect(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await refuseBypass(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { db: database(pool), close: () => pool.end() };
}

/** The schema's queries over `pool`, with camelCase fields as snake_case columns. */
export function database(pool: pg.Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/**
 * Throws if `pool` connects as a superuser or a role with BYPASSRLS: row-level security doesn't
 * apply to them even when forced, so one household could see another's rows (ADR-0008 §9).
 */
export async function refuseBypass(pool: pg.Pool) {
  const { rows } = await pool.query<{ role: string; bypasses: boolean }>(
    'select rolname as role, rolsuper or rolbypassrls as bypasses from pg_roles where rolname = current_user',
  );
  const [current] = rows;
  if (!current || current.bypasses) {
    throw new Error(
      `The database role ${current?.role ?? '(unknown)'} bypasses row-level security. Connect as a ` +
        'role without superuser or BYPASSRLS rights (ADR-0008 §9).',
    );
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction that sees and changes only `householdId`'s rows: row-level security
 * keys on a setting that lasts for this transaction only (ADR-0008 §9, CODE-17). Outside it, the
 * household tables show and accept nothing.
 */
export async function inHousehold<T>(
  db: Database,
  householdId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!uuid.test(householdId)) throw new RangeError(`Not a household id: ${householdId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('householdr.household_id', ${householdId}, true)`);
    return work(tx);
  });
}
