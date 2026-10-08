import {
  accounts,
  credentials,
  inHousehold,
  members,
  passkeys,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settableClock } from '../testing';
import { createHousehold } from './create-household';
import { accountHouseholdList, mayTurnOffTwoFactor, membership, viewHousehold } from './membership';

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
const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));

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

/** Gives `account` a passkey that no device holds. */
const addPasskey = (account: string) =>
  db.insert(passkeys).values({
    userId: account,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
/** Gives `account` a password, as the library keeps one: by its hash. */
const addPassword = (account: string) =>
  db.insert(credentials).values({
    userId: account,
    accountId: account,
    providerId: 'credential',
    password: 'a-slow-hash',
  });
/** Turns codes from an authenticator app on or off for `account` (ADR-0010 §2). */
const setTotp = (account: string, on: boolean) =>
  db.update(accounts).set({ twoFactorEnabled: on }).where(eq(accounts.id, account));

describe('membership (ADR-0017 §2)', () => {
  it('is the account’s member in the household, with two factors once it has a passkey', async () => {
    const robin = await newAccount();
    const id = await household(robin);
    const head = await membership({ db }, robin, id);
    expect(head).toMatchObject({ role: 'head', hasAccount: true, twoFactor: false });
    await addPasskey(robin);
    expect(await membership({ db }, robin, id)).toMatchObject({ twoFactor: true });
  });

  it('has two factors with a password once TOTP is on, and not before (ADR-0010 §3)', async () => {
    const robin = await newAccount();
    const id = await household(robin);
    await addPassword(robin);
    expect(await membership({ db }, robin, id)).toMatchObject({ role: 'head', twoFactor: false });
    await setTotp(robin, true);
    expect(await membership({ db }, robin, id)).toMatchObject({ role: 'head', twoFactor: true });
    await setTotp(robin, false);
    expect(await membership({ db }, robin, id)).toMatchObject({ twoFactor: false });
  });

  it('has no two factors from TOTP without a password', async () => {
    const robin = await newAccount();
    const id = await household(robin);
    await setTotp(robin, true);
    expect(await membership({ db }, robin, id)).toMatchObject({ twoFactor: false });
  });

  it('is nothing for an account outside the household, or an id that isn’t one', async () => {
    const id = await household(await newAccount());
    expect(await membership({ db }, await newAccount(), id)).toBeNull();
    expect(await membership({ db }, await newAccount(), crypto.randomUUID())).toBeNull();
    expect(await membership({ db }, await newAccount(), "x' or 1=1 --")).toBeNull();
  });
});

describe('mayTurnOffTwoFactor (ADR-0010 §3)', () => {
  /** An account with a password and TOTP on, as anyone who can turn TOTP off has. */
  const withTotp = async () => {
    const account = await newAccount();
    await addPassword(account);
    await setTotp(account, true);
    return account;
  };

  it('refuses a head without a passkey, whose password would be left on its own', async () => {
    const robin = await withTotp();
    await household(robin);
    expect(await mayTurnOffTwoFactor({ db }, robin)).toBe(false);
    await addPasskey(robin);
    expect(await mayTurnOffTwoFactor({ db }, robin)).toBe(true);
  });

  it('refuses a head of any of the account’s households', async () => {
    const robin = await withTotp();
    const sam = await newAccount();
    await addMembers(await household(sam), { name: 'Robin', role: 'adult', accountId: robin });
    expect(await mayTurnOffTwoFactor({ db }, robin)).toBe(true);
    await household(robin, 'Birch Court');
    expect(await mayTurnOffTwoFactor({ db }, robin)).toBe(false);
  });

  it('lets an account that heads no household turn it off', async () => {
    expect(await mayTurnOffTwoFactor({ db }, await withTotp())).toBe(true);
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
    const view = await viewHousehold({ db, clock, householdId: id, member });
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
    expect(await viewHousehold({ db, clock, householdId: id, member: profile })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });
});
