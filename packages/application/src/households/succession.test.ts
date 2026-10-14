import { accounts, activityLog, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { leaveHousehold } from './leave';
import { membership, viewHousehold, type HouseholdContext } from './membership';
import { answerHeadRole } from './succession';

// A member the last head named head as they left takes it on or declines it (ADR-0018 §2,
// ADR-0010 §3, with their clarifications), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

/** Adds an adult with an account to `h`, who joined on `joinedAt`, and returns them as members. */
const addAdult = async (h: PlannedHousehold, name: string, joinedAt: string) => {
  const [account] = await db
    .insert(accounts)
    .values({ name, email: `${name}-${crypto.randomUUID()}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  await h.inIt((tx) =>
    tx.insert(members).values({
      householdId: h.householdId,
      name,
      role: 'adult',
      accountId: account.id,
      joinedAt: new Date(joinedAt),
    }),
  );
  return account.id;
};

/** `accountId`'s membership of `h` as the guard finds it now. */
const as = async (h: PlannedHousehold, accountId: string): Promise<HouseholdContext> => {
  const member = await membership({ db }, accountId, h.householdId);
  if (!member) throw new Error('Not a member');
  return { db, clock: h.clock, householdId: h.householdId, member };
};

/** The current members' names and roles, and whether they were named head, by name. */
const roles = async (h: PlannedHousehold) =>
  (
    await h.inIt((tx) =>
      tx
        .select({ name: members.name, role: members.role, namedHead: members.namedHead })
        .from(members)
        .where(isNull(members.leftAt)),
    )
  ).sort((a, b) => a.name.localeCompare(b.name));

/** Robin, the last head, leaves Alex and Sam, who joined later, naming Alex head. */
async function named() {
  const h = await plannedHousehold(db);
  const sam = await addAdult(h, 'Sam', '2026-10-03T00:00:00Z');
  const left = await leaveHousehold(h.head, { shownAs: 'name', successor: h.alex });
  if (!left.ok) throw new Error('Not left');
  const alexAccount = await h.inIt(async (tx) => {
    const [row] = await tx
      .select({ id: members.accountId })
      .from(members)
      .where(eq(members.id, h.alex));
    return row?.id;
  });
  if (!alexAccount) throw new Error('No account');
  return { h, alex: await as(h, alexAccount), sam: await as(h, sam) };
}

describe('answerHeadRole (ADR-0018 §2, clarification)', () => {
  it('keeps the role for a successor who takes it on, and asks no more', async () => {
    const { h, alex } = await named();
    expect(await viewHousehold(alex)).toMatchObject({ namedHead: { mayDecline: true } });
    expect(await answerHeadRole(alex, { answer: 'take on' })).toEqual({ ok: true });
    expect(await roles(h)).toEqual([
      { name: 'Alex', role: 'head', namedHead: false },
      { name: 'Sam', role: 'adult', namedHead: false },
    ]);
    expect(await viewHousehold(alex)).toMatchObject({ namedHead: null });
    expect(await answerHeadRole(alex, { answer: 'decline' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('passes it on to the adult with an account longest there for one who declines', async () => {
    const { h, alex, sam } = await named();
    expect(await answerHeadRole(alex, { answer: 'decline' })).toEqual({ ok: true });
    // The page after declining, with the role the request began with, no longer asks Alex anything.
    expect(await viewHousehold(alex)).toMatchObject({ namedHead: null, needsTwoFactors: false });
    expect(await roles(h)).toEqual([
      { name: 'Alex', role: 'adult', namedHead: false },
      { name: 'Sam', role: 'head', namedHead: false },
    ]);
    // Nobody is asked again, and nothing is logged (ADR-0018 §8).
    expect(await viewHousehold(await as(h, await accountOf(h, sam)))).toMatchObject({
      namedHead: null,
    });
    expect(await h.inIt((tx) => tx.select().from(activityLog))).toEqual([]);
  });

  it('can’t be declined by the only adult with an account', async () => {
    const h = await plannedHousehold(db);
    await leaveHousehold(h.head, { shownAs: 'name', successor: h.alex });
    const alex = await as(h, await accountOf(h, h.adult));
    expect(await viewHousehold(alex)).toMatchObject({ namedHead: { mayDecline: false } });
    expect(await answerHeadRole(alex, { answer: 'decline' })).toEqual({
      ok: false,
      error: 'only-adult',
    });
    expect(await roles(h)).toEqual([{ name: 'Alex', role: 'head', namedHead: true }]);
    expect(await answerHeadRole(alex, { answer: 'take on' })).toEqual({ ok: true });
  });

  it('is only for the member named, with a known answer', async () => {
    const { h, alex, sam } = await named();
    expect(await answerHeadRole(sam, { answer: 'take on' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await answerHeadRole(alex, { answer: 'maybe' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    // Someone the rule made head, without being named, isn't asked.
    const other = await plannedHousehold(db);
    await leaveHousehold(other.head, { shownAs: 'name' });
    const head = await as(other, await accountOf(other, other.adult));
    expect(await viewHousehold(head)).toMatchObject({ namedHead: null });
    expect(await answerHeadRole(head, { answer: 'decline' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect((await roles(h)).find(({ name }) => name === 'Alex')).toMatchObject({
      namedHead: true,
    });
  });
});

describe('viewHousehold for a head without two factors (ADR-0010 §3)', () => {
  it('asks them to set two factors up, and nobody else', async () => {
    const { alex, sam } = await named();
    expect(await viewHousehold(alex)).toMatchObject({ needsTwoFactors: true });
    expect(await viewHousehold(sam)).toMatchObject({ needsTwoFactors: false });
    // Robin, the founding head, has a passkey.
    const robin = await plannedHousehold(db);
    expect(await viewHousehold(robin.head)).toMatchObject({ needsTwoFactors: false });
  });
});

/** The account of `member`'s profile in `h`. */
async function accountOf(h: PlannedHousehold, member: HouseholdContext) {
  const id = await h.inIt(async (tx) => {
    const [row] = await tx
      .select({ id: members.accountId })
      .from(members)
      .where(eq(members.id, member.member.id));
    return row?.id;
  });
  if (!id) throw new Error('No account');
  return id;
}
