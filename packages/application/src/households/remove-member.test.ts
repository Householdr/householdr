import {
  activityLog,
  invitations,
  members,
  parentalConsents,
  profileGuardians,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { householdActivity } from './activity';
import { membership, type HouseholdContext } from './membership';
import { memberToRemove, removeMember } from './remove-member';

// Heads removing a member (ADR-0005 §4, ADR-0018 §4–§5, with their clarifications), on a real
// database (TEST-11) with a clock the tests set (TEST-2).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The household's clock reads Thursday 8 October 2026, 10:00 in Brussels; weeks start on Mondays.
const thisWeek = '2026-10-05';

/** Robin, a head with two factors, and Alex, with this week's plan published: started now. */
async function started() {
  const h = await plannedHousehold(db, { started: thisWeek, startedNow: true });
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  await draftPlan(h.head, { week: thisWeek });
  const plan = await h.plan(thisWeek);
  await publishPlan(h.head, { week: thisWeek, version: plan?.version });
  return h;
}

const recently = (context: HouseholdContext, recentSignIn = true) => ({
  ...context,
  recentSignIn,
});

/** A member's record. */
const row = async (h: PlannedHousehold, id: string) => {
  const [found] = await h.inIt((tx) => tx.select().from(members).where(eq(members.id, id)));
  return found;
};

/** Adds a profile to the household, a child with a guardian and a consent record if `child`. */
const profile = async (h: PlannedHousehold, name: string, child = false) => {
  const [added] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({
        householdId: h.householdId,
        name,
        role: child ? 'child' : 'adult',
        birthDate: child ? '2016-03-01' : null,
        joinedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .returning({ id: members.id }),
  );
  if (!added) throw new Error('No profile');
  return added.id;
};

describe('removeMember (ADR-0005 §4, ADR-0018 §4)', () => {
  it('ends the membership as leaving does, shown as “Former member”, and logs it', async () => {
    const h = await started();
    const accountId = (await row(h, h.alex))?.accountId;
    expect(await removeMember(recently(h.head), { member: h.alex })).toEqual({ ok: true });
    expect(await row(h, h.alex)).toMatchObject({
      leftAt: new Date('2026-10-08T08:00:00Z'),
      accountId: null,
      showsName: false,
    });
    if (!accountId) throw new Error('No account');
    expect(await membership({ db }, accountId, h.householdId)).toBeNull();
    // What Alex had to do went to Robin.
    const plan = await h.plan(thisWeek);
    expect(new Set(plan?.rows.map((r) => r.member))).toEqual(new Set(['Robin']));
    // Every member sees it, the subject as a former member (ADR-0018 §2, §5).
    const log = await householdActivity(h.head);
    expect(log.ok && log.entries.map((e) => [e.action, e.actor, e.subject, e.byReader])).toEqual([
      ['member.removed', 'Robin', null, true],
    ]);
  });

  it('needs a recent sign-in, and changes nothing without one (ADR-0010 §6)', async () => {
    const h = await started();
    expect(await removeMember(recently(h.head, false), { member: h.alex })).toEqual({
      ok: false,
      error: 'not-recent',
    });
    expect(await row(h, h.alex)).toMatchObject({ leftAt: null });
    expect(await h.inIt((tx) => tx.select().from(activityLog))).toEqual([]);
  });

  it('is for heads with two factors, never on a head or themselves (ADR-0018 §4, TEST-4)', async () => {
    const h = await started();
    const sam = await profile(h, 'Sam');
    for (const [context, member] of [
      [h.adult, sam],
      [{ ...h.head, member: { ...h.head.member, twoFactor: false } }, sam],
      [h.head, h.robin],
    ] as const) {
      expect(await removeMember(recently(context), { member })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    await h.inIt((tx) => tx.update(members).set({ role: 'head' }).where(eq(members.id, h.alex)));
    expect(await removeMember(recently(h.head), { member: h.alex })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    // Not a member of this household, or not one any more.
    const other = await plannedHousehold(db);
    expect(await removeMember(recently(h.head), { member: other.alex })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await removeMember(recently(h.head), { member: 'Sam' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await removeMember(recently(h.head), { member: sam })).toEqual({ ok: true });
    expect(await removeMember(recently(h.head), { member: sam })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('keeps a child’s guardians and consent, and a profile’s link goes', async () => {
    const h = await started();
    const kim = await profile(h, 'Kim', true);
    const robinsAccount = (await row(h, h.robin))?.accountId;
    if (!robinsAccount) throw new Error('No account');
    await h.inIt(async (tx) => {
      await tx
        .insert(profileGuardians)
        .values({ householdId: h.householdId, memberId: kim, accountId: robinsAccount });
      await tx.insert(parentalConsents).values({
        householdId: h.householdId,
        memberId: kim,
        givenBy: robinsAccount,
        givenAt: new Date('2026-10-01T10:00:00Z'),
        text: 'I consent.',
        language: 'en',
      });
    });
    const sam = await profile(h, 'Sam');
    await h.inIt((tx) =>
      tx.insert(invitations).values({
        householdId: h.householdId,
        memberId: sam,
        tokenHash: `hash-${sam}`,
        expiresAt: new Date('2026-10-15T10:00:00Z'),
      }),
    );
    expect(await removeMember(recently(h.head), { member: kim })).toEqual({ ok: true });
    expect(await removeMember(recently(h.head), { member: sam })).toEqual({ ok: true });
    expect(await row(h, kim)).toMatchObject({ leftAt: new Date('2026-10-08T08:00:00Z') });
    expect(await h.inIt((tx) => tx.select().from(profileGuardians))).toHaveLength(1);
    expect(await h.inIt((tx) => tx.select().from(parentalConsents))).toHaveLength(1);
    expect(await h.inIt((tx) => tx.select().from(invitations))).toEqual([]);
  });

  it('deletes a profile with nothing to keep, and isn’t logged before the start', async () => {
    const h = await plannedHousehold(db, { started: null });
    const sam = await profile(h, 'Sam');
    expect(await removeMember(recently(h.head), { member: sam })).toEqual({ ok: true });
    expect(await row(h, sam)).toBeUndefined();
    expect(await h.inIt((tx) => tx.select().from(activityLog))).toEqual([]);
  });

  it('logs removing a profile with nothing to keep, which the log then names as no one', async () => {
    const h = await started();
    // Added after this week's plan was drafted: nothing to keep.
    const [late] = await h.inIt((tx) =>
      tx
        .insert(members)
        .values({ householdId: h.householdId, name: 'Sam', role: 'adult' })
        .returning({ id: members.id }),
    );
    if (!late) throw new Error('No profile');
    expect(await removeMember(recently(h.head), { member: late.id })).toEqual({ ok: true });
    expect(await row(h, late.id)).toBeUndefined();
    const log = await householdActivity(h.adult);
    expect(log.ok && log.entries.map((e) => [e.action, e.subject])).toEqual([
      ['member.removed', null],
    ]);
  });
});

describe('memberToRemove (ADR-0005 §4)', () => {
  it('gives the member a head is asked to confirm removing, and whether to confirm first', async () => {
    const h = await started();
    expect(await memberToRemove(recently(h.head), { member: h.alex })).toEqual({
      ok: true,
      household: 'Ash Lane',
      name: 'Alex',
      role: 'adult',
      confirm: false,
    });
    expect(await memberToRemove(recently(h.head, false), { member: h.alex })).toMatchObject({
      confirm: true,
    });
    expect(await memberToRemove(recently(h.adult), { member: h.robin })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await memberToRemove(recently(h.head), { member: 'x' })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });
});
