import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from './auth-schema';
import { inHousehold, type Database } from './connection';
import { accountHouseholds, invitationHousehold } from './lookups';
import { households, invitations, members } from './schema';
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

describe('invitationHousehold (ADR-0010 §5)', () => {
  /** An invitation to the profile without an account of a new household, by `tokenHash`. */
  const invited = async (tokenHash: string) => {
    const id = await newHousehold();
    await inHousehold(db, id, async (tx) => {
      const [kim] = await tx.select({ id: members.id }).from(members);
      if (!kim) throw new Error('No profile');
      await tx.insert(invitations).values({
        memberId: kim.id,
        householdId: id,
        tokenHash,
        expiresAt: new Date('2026-10-15T08:00:00Z'),
      });
    });
    return id;
  };

  it('finds the household of an invitation by its token’s hash, and nothing for any other', async () => {
    const ash = await invited('hash-of-ash');
    const birch = await invited('hash-of-birch');
    expect(await invitationHousehold(db, 'hash-of-ash')).toBe(ash);
    expect(await invitationHousehold(db, 'hash-of-birch')).toBe(birch);
    expect(await invitationHousehold(db, 'hash-of-nothing')).toBeNull();
    expect(await invitationHousehold(db, "' or 1=1 --")).toBeNull();
  });

  it('shows nothing else of the invitation without its household set', async () => {
    await invited('hash-of-cedar');
    expect(await db.select().from(invitations)).toEqual([]);
  });
});

describe('the lookup functions (ADR-0008 §9, clarification)', () => {
  it('are these, and no others, so a new one is reviewed', async () => {
    const { rows } = await db.execute<{ name: string }>(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'auth') and p.prosecdef
      order by name`);
    expect(rows.map((row) => row.name)).toEqual(['account_households', 'invitation_household']);
  });

  it('return household ids, and nothing else', async () => {
    const { rows } = await db.execute<{ name: string; result: string }>(sql`
      select p.proname as name, pg_get_function_result(p.oid) as result
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`);
    expect(rows).toEqual([
      { name: 'account_households', result: 'SETOF uuid' },
      { name: 'invitation_household', result: 'SETOF uuid' },
    ]);
  });
});
