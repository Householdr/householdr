import { accounts, households, inHousehold, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import type { Account, SignedIn } from '@householdr/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from './create-household';

// Creating a household with its founding head (ADR-0007 §2, ADR-0010 §1, §3), on a real database
// (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

/** A new account, signed in with two factors unless said otherwise. */
const founder = async (twoFactor = true, managed = false) => {
  const [row] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  const actor: SignedIn = { account: row.id, twoFactor };
  const account: Account = { id: row.id, managed, guardians: [] };
  return { db, actor, account };
};

const input = {
  name: 'Ash Lane',
  headName: 'Robin',
  country: 'BE',
  timeZone: 'Europe/Brussels',
  language: 'en',
  weekStartDay: 1,
  adult: true,
};

/** The household `id` and its members, as a transaction set to it sees them. */
const stored = (id: string) =>
  inHousehold(db, id, async (tx) => ({
    households: await tx
      .select({
        name: households.name,
        country: households.country,
        timeZone: households.timeZone,
        language: households.language,
        weekStartDay: households.weekStartDay,
      })
      .from(households),
    members: await tx
      .select({
        id: members.id,
        name: members.name,
        role: members.role,
        accountId: members.accountId,
      })
      .from(members),
  }));

describe('creating a household (ADR-0007 §2)', () => {
  it('stores its settings, with the account creating it as its only head', async () => {
    const context = await founder();
    const result = await createHousehold(context, {
      ...input,
      name: '  Ash Lane ',
      headName: ' Robin',
      country: 'ES',
      timeZone: 'Atlantic/Canary',
      weekStartDay: 7,
    });
    if (!result.ok) throw new Error(`Not created: ${result.error}`);
    expect(await stored(result.householdId)).toEqual({
      households: [
        {
          name: 'Ash Lane',
          country: 'ES',
          timeZone: 'Atlantic/Canary',
          language: 'en',
          weekStartDay: 7,
        },
      ],
      members: [
        { id: result.memberId, name: 'Robin', role: 'head', accountId: context.account.id },
      ],
    });
  });

  it('needs an account with two factors, and not a child’s (ADR-0010 §1, §3)', async () => {
    for (const context of [await founder(false), await founder(true, true)]) {
      expect(await createHousehold(context, input)).toEqual({ ok: false, error: 'not-allowed' });
    }
    const someoneElse = await founder();
    const other = await founder();
    expect(await createHousehold({ ...someoneElse, account: other.account }, input)).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('says which fields aren’t valid', async () => {
    const context = await founder();
    const invalid = (fields: Record<string, unknown>) =>
      createHousehold(context, { ...input, ...fields });
    expect(await invalid({ name: ' ', headName: 'x'.repeat(101) })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'headName'],
    });
    // The EU and the EEA only (ADR-0016 §1), with one of the country's time zones.
    expect(await invalid({ country: 'GB', timeZone: 'Europe/London' })).toMatchObject({
      fields: ['country'],
    });
    expect(await invalid({ timeZone: 'Europe/Paris' })).toMatchObject({ fields: ['timeZone'] });
    // One of the offered languages (ADR-0016 §1, §2).
    expect(await invalid({ language: 'de' })).toMatchObject({ fields: ['language'] });
    expect(await invalid({ weekStartDay: 0 })).toMatchObject({ fields: ['weekStartDay'] });
    expect(await invalid({ weekStartDay: '1' })).toMatchObject({ fields: ['weekStartDay'] });
    // Only someone 18 or older creates one (ADR-0010 §1).
    expect(await invalid({ adult: false })).toMatchObject({ fields: ['adult'] });
    expect(await createHousehold(context, 'Ash Lane')).toEqual({
      ok: false,
      error: 'invalid',
      fields: [],
    });
  });

  it('joins the transaction it is given, so the household goes if the rest fails', async () => {
    const context = await founder();
    let created: string | undefined;
    await db
      .transaction(async (tx) => {
        const result = await createHousehold({ ...context, db: tx }, input);
        if (result.ok) created = result.householdId;
        throw new Error('What came after failed.');
      })
      .catch(() => undefined);
    if (!created) throw new Error('Not created');
    expect(await stored(created)).toEqual({ households: [], members: [] });
  });
});
