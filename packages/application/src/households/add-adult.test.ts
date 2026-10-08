import { accounts, inHousehold, members, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addAdult } from './add-adult';
import { createHousehold } from './create-household';
import { membership, viewHousehold } from './membership';

// Adding an adult's profile (ADR-0007 §1, §2), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
const newAccount = async () => {
  const [row] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org` })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  return row.id;
};

/** Gives the account a passkey, its second factor (ADR-0010 §3). */
const addPasskey = (userId: string) =>
  db.insert(passkeys).values({
    userId,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });

/** A household and its founding head, as the guard finds them; with two factors unless said. */
const founded = async (twoFactor = true) => {
  const account = await newAccount();
  if (twoFactor) await addPasskey(account);
  const result = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account, result.householdId);
  if (!member) throw new Error('Not a member');
  return { db, householdId: result.householdId, member };
};

const profilesOf = (householdId: string) =>
  inHousehold(db, householdId, (tx) =>
    tx
      .select({
        name: members.name,
        role: members.role,
        birthDate: members.birthDate,
        accountId: members.accountId,
      })
      .from(members)
      .where(eq(members.role, 'adult')),
  );

describe('addAdult (ADR-0007 §1, §2)', () => {
  it('adds a profile without an account, its name trimmed', async () => {
    const head = await founded();
    const result = await addAdult(head, { name: '  Sam  ' });
    expect(result).toEqual({ ok: true, memberId: expect.any(String) as string, name: 'Sam' });
    expect(await profilesOf(head.householdId)).toEqual([
      { name: 'Sam', role: 'adult', birthDate: null, accountId: null },
    ]);
    const view = await viewHousehold(head);
    expect(view).toMatchObject({ members: [{ role: 'head' }, { name: 'Sam', role: 'adult' }] });
  });

  it('needs a name, of up to 100 characters', async () => {
    const head = await founded();
    for (const name of ['', '   ', 'x'.repeat(101), 42, undefined]) {
      expect(await addAdult(head, { name })).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await addAdult(head, { name: 'x'.repeat(100) })).toMatchObject({ ok: true });
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const withoutTwoFactor = await founded(false);
    expect(await addAdult(withoutTwoFactor, { name: 'Sam' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    const head = await founded();
    const adult = { ...head.member, role: 'adult' as const };
    expect(await addAdult({ ...head, member: adult }, { name: 'Sam' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await profilesOf(withoutTwoFactor.householdId)).toEqual([]);
    expect(await profilesOf(head.householdId)).toEqual([]);
  });

  it('tells the page whether the member viewing may add members', async () => {
    const head = await founded();
    expect(await viewHousehold(head)).toMatchObject({ mayAddMembers: true });
    const adult = { ...head.member, role: 'adult' as const };
    expect(await viewHousehold({ ...head, member: adult })).toMatchObject({ mayAddMembers: false });
    expect(await viewHousehold(await founded(false))).toMatchObject({ mayAddMembers: false });
  });
});
