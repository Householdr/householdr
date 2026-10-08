import { accounts, inHousehold, members, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from './create-household';
import { accountHouseholdList, membership, viewHousehold } from './membership';

// Who is a member of which household, and what they see of it (ADR-0017 §2, ADR-0007 §1), on a
// real database (TEST-11).

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
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  return row.id;
};
const signedIn = (account: string) => ({ account, twoFactor: true });

/** A household created by `founder`, as its head. */
const household = async (founder: string, name = 'Ash Lane') => {
  const result = await createHousehold(
    { db, actor: signedIn(founder), account: { id: founder, managed: false, guardians: [] } },
    {
      name,
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  return result.householdId;
};

/** Adds profiles to household `id`, linked to `accountId` when given. */
const addMembers = (
  id: string,
  ...profiles: { name: string; role: 'adult' | 'child'; accountId?: string }[]
) =>
  inHousehold(db, id, (tx) =>
    tx.insert(members).values(
      profiles.map((profile) => ({
        householdId: id,
        ...profile,
        birthDate: profile.role === 'child' ? '2016-03-01' : null,
      })),
    ),
  );

describe('membership (ADR-0017 §2)', () => {
  it('is the account’s member in the household, with two factors once it has a passkey', async () => {
    const robin = await newAccount();
    const id = await household(robin);
    const head = await membership({ db }, robin, id);
    expect(head).toMatchObject({ role: 'head', hasAccount: true, twoFactor: false });
    await db.insert(passkeys).values({
      userId: robin,
      publicKey: 'a-key',
      credentialID: `credential-${String(++next)}`,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });
    expect(await membership({ db }, robin, id)).toMatchObject({ twoFactor: true });
  });

  it('is nothing for an account outside the household, or an id that isn’t one', async () => {
    const id = await household(await newAccount());
    expect(await membership({ db }, await newAccount(), id)).toBeNull();
    expect(await membership({ db }, await newAccount(), crypto.randomUUID())).toBeNull();
    expect(await membership({ db }, await newAccount(), "x' or 1=1 --")).toBeNull();
  });
});

describe('accountHouseholdList (ADR-0008 §9, clarification)', () => {
  it('lists the account’s households by name, with its role in each, and no others', async () => {
    const robin = await newAccount();
    const sam = await newAccount();
    const birch = await household(robin, 'Birch Court');
    const ash = await household(sam, 'Ash Lane');
    await addMembers(ash, { name: 'Robin', role: 'adult', accountId: robin });
    await household(sam, 'Cedar Row');
    expect(await accountHouseholdList({ db }, robin)).toEqual([
      { id: ash, name: 'Ash Lane', role: 'adult' },
      { id: birch, name: 'Birch Court', role: 'head' },
    ]);
    expect(await accountHouseholdList({ db }, await newAccount())).toEqual([]);
  });
});

describe('viewHousehold (ADR-0007 §1, ADR-0018 §3)', () => {
  it('shows the household’s name and members, heads first, then adults and children', async () => {
    const robin = await newAccount();
    const id = await household(robin);
    await addMembers(id, { name: 'Sam', role: 'child' }, { name: 'Alex', role: 'adult' });
    const member = await membership({ db }, robin, id);
    if (!member) throw new Error('Not a member');
    const view = await viewHousehold({ db, householdId: id, member });
    expect(view).toMatchObject({
      ok: true,
      name: 'Ash Lane',
      members: [
        { id: member.id, name: 'Robin', role: 'head' },
        { name: 'Alex', role: 'adult' },
        { name: 'Sam', role: 'child' },
      ],
    });
  });

  it('shows nothing to a profile without an account, which can’t act (ADR-0018 §4)', async () => {
    const id = await household(await newAccount());
    const profile = {
      id: crypto.randomUUID(),
      role: 'adult' as const,
      hasAccount: false,
      twoFactor: false,
    };
    expect(await viewHousehold({ db, householdId: id, member: profile })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });
});
