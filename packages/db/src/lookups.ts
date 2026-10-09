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
 * The id of the household whose invitation's token hashes to `tokenHash`, if any, found before one
 * is set (ADR-0008 §9, clarifications; ADR-0010 §5). Read the invitation itself with `inHousehold`.
 */
export async function invitationHousehold(
  db: Database | Transaction,
  tokenHash: string,
): Promise<string | null> {
  const { rows } = await db.execute<{ id: string }>(
    sql`select invitation_household(${tokenHash}) as id`,
  );
  return rows[0]?.id ?? null;
}
