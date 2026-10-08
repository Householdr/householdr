import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './connection';

/**
 * The ids of the households `accountId` is a member of, found before one is set, through the
 * database function the migrations made for it (ADR-0008 §9, clarifications). Read each one with
 * `inHousehold`, as usual.
 */
export async function accountHouseholds(
  db: Database | Transaction,
  accountId: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(
    sql`select account_households(${accountId}::uuid) as id`,
  );
  return rows.map((row) => row.id);
}

/**
 * The ids of the households past setup, which have a first plan week (ADR-0007 §2), found before
 * one is set, for the scheduler (ADR-0008 §10). Read each one with `inHousehold`, as usual.
 */
export async function startedHouseholds(db: Database | Transaction): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`select started_households() as id`);
  return rows.map((row) => row.id);
}
