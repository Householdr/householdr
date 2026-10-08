import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from './auth-schema';
import { inHousehold, type Database } from './connection';
import { accountHouseholds } from './lookups';
import { households, members } from './schema';
import { testDatabase } from './testing';

// The lookups that find households before one is set (ADR-0008 §9, clarifications), as the app's
// role, which row-level security binds (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
const newAccount = async () => {
  const [row] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  return row.id;
};
/** A household with a profile for each of `accountIds`, and one without an account. */
const newHousehold = async (...accountIds: string[]) => {
  const id = newId();
  await inHousehold(db, id, async (tx) => {
    await tx.insert(households).values({
      id,
      name: 'Ash Lane',
      country: 'BE',
      language: 'en',
      timeZone: 'Europe/Brussels',
      weekStartDay: 1,
    });
    await tx.insert(members).values([
      ...accountIds.map((accountId) => ({
        householdId: id,
        name: 'Robin',
        role: 'adult' as const,
        accountId,
      })),
      { householdId: id, name: 'Kim', role: 'adult' },
    ]);
  });
  return id;
};

describe('accountHouseholds (ADR-0008 §9, clarification)', () => {
  it('finds the households an account is a member of, and no others', async () => {
    const robin = await newAccount();
    const sam = await newAccount();
    const ash = await newHousehold(robin, sam);
    const birch = await newHousehold(robin);
    await newHousehold(sam);
    expect((await accountHouseholds(db, robin)).sort()).toEqual([ash, birch].sort());
    expect(await accountHouseholds(db, await newAccount())).toEqual([]);
  });

  it('works in any transaction, set to a household or not', async () => {
    const robin = await newAccount();
    const ash = await newHousehold(robin);
    expect(await db.transaction((tx) => accountHouseholds(tx, robin))).toEqual([ash]);
  });
});

describe('the lookup functions (ADR-0008 §9, clarification)', () => {
  it('are these, and no others, so a new one is reviewed', async () => {
    const { rows } = await db.execute<{ name: string }>(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'auth') and p.prosecdef
      order by name`);
    expect(rows.map((row) => row.name)).toEqual(['account_households']);
  });

  it('return household ids, and nothing else', async () => {
    const { rows } = await db.execute<{ name: string; result: string }>(sql`
      select p.proname as name, pg_get_function_result(p.oid) as result
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`);
    expect(rows).toEqual([{ name: 'account_households', result: 'SETOF uuid' }]);
  });
});
