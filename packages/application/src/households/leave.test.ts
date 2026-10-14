import {
  absences,
  accounts,
  activityLog,
  assignments,
  comparisons,
  ledgerEntries,
  members,
  unavailabilities,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportUnavailable } from '../availability/unavailability';
import { completeOccurrence } from '../completions/complete-occurrence';
import { settlePlanWeek } from '../ledger/settle-plan-week';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { householdActivity } from './activity';
import { leaveHousehold, leaveOptions } from './leave';
import { membership, viewHousehold, type HouseholdContext } from './membership';

// Leaving (ADR-0005 §4, ADR-0018 §2, §8, with their clarifications), on a real database (TEST-11)
// with a clock the tests set (TEST-2).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The household's clock reads Thursday 8 October 2026, 10:00 in Brussels; weeks start on Mondays,
// and this one is the household's first.
const thisWeek = '2026-10-05';
const nextWeek = '2026-10-12';

/** Robin and Alex, with this week's plan published: the dishes every day from today, Alex's. */
async function published() {
  const h = await plannedHousehold(db, { started: thisWeek, startedNow: true });
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  const drafted = await draftPlan(h.head, { week: thisWeek });
  if (!drafted.ok) throw new Error('Not drafted');
  await h.inIt((tx) => tx.update(assignments).set({ memberId: h.alex, reason: 'bound' }));
  const plan = await h.plan(thisWeek);
  await publishPlan(h.head, { week: thisWeek, version: plan?.version });
  h.clock.advance({ hours: 1 });
  return h;
}

/** Who has each occurrence of the plan of `week`, and why. */
const whoHas = async (h: PlannedHousehold, week = thisWeek) =>
  ((await h.plan(week))?.rows ?? []).map(
    (row) => `${row.date}: ${row.member ?? '-'} (${row.reason ?? row.cause ?? ''})`,
  );

/** Alex's member record. */
const alexRow = async (h: PlannedHousehold) => {
  const [row] = await h.inIt((tx) => tx.select().from(members).where(eq(members.id, h.alex)));
  return row;
};

const leave = (context: HouseholdContext, shownAs = 'former member') =>
  leaveHousehold(context, { shownAs });

describe('leaveHousehold (ADR-0005 §4, ADR-0018 §2)', () => {
  it('makes the member a former member at once, without an account or share', async () => {
    const h = await published();
    await h.share(h.alex, 50);
    const accountId = (await alexRow(h))?.accountId;
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await alexRow(h)).toMatchObject({
      leftAt: new Date('2026-10-08T09:00:00Z'),
      accountId: null,
      sharePercent: null,
      showsName: false,
    });
    // Their account is no longer in it, and the household sees only that.
    if (!accountId) throw new Error('No account');
    expect(await membership({ db }, accountId, h.householdId)).toBeNull();
    const view = await viewHousehold(h.head);
    expect(view.ok && view.members.map((m) => m.name)).toEqual(['Robin']);
    // Not logged (ADR-0018 §8).
    expect(await h.inIt((tx) => tx.select().from(activityLog))).toEqual([]);
  });

  it('shows them as they chose in the household’s history', async () => {
    for (const [shownAs, name] of [
      ['former member', null],
      ['name', 'Alex'],
    ] as const) {
      const h = await published();
      const [first] = (await h.plan(thisWeek))?.rows ?? [];
      // Robin logs Alex's dishes for them, which the log shows with Alex's name.
      await completeOccurrence(h.head, { occurrence: first?.occurrence, doers: [h.alex] });
      expect(await leave(h.adult, shownAs)).toEqual({ ok: true });
      const log = await householdActivity(h.head);
      expect(log.ok && log.entries.map((e) => e.subject)).toEqual([name]);
    }
  });

  it('moves their open work this week to others, and leaves what nobody can do unassigned', async () => {
    const h = await published();
    // Robin is away on Saturday; the dishes of Monday to Wednesday were never theirs to do.
    await h.absent(h.robin, '2026-10-10', '2026-10-10');
    const [today] = (await h.plan(thisWeek))?.rows ?? [];
    await completeOccurrence(h.adult, { occurrence: today?.occurrence });
    await h.inIt(async (tx) => {
      const rows = (await h.plan(thisWeek))?.rows ?? [];
      const saturday = rows.find((row) => row.date === '2026-10-10');
      // Saturday's dishes have to be done on Saturday; Friday's had to be done by this morning.
      const friday = rows.find((row) => row.date === '2026-10-09');
      if (!saturday || !friday) throw new Error('No dishes');
      await tx
        .update(assignments)
        .set({
          windowStart: new Date('2026-10-09T22:00:00Z'),
          windowEnd: new Date('2026-10-10T22:00:00Z'),
        })
        .where(eq(assignments.occurrenceId, saturday.occurrence));
      await tx
        .update(assignments)
        .set({
          windowStart: new Date('2026-10-07T22:00:00Z'),
          windowEnd: new Date('2026-10-08T06:00:00Z'),
        })
        .where(eq(assignments.occurrenceId, friday.occurrence));
    });
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await whoHas(h)).toEqual([
      // Done work stays theirs, under a former member's record.
      '2026-10-08: Alex (bound)',
      '2026-10-09: - (nobody eligible)',
      '2026-10-10: - (nobody eligible)',
      '2026-10-11: Robin (re-allocated: member unavailable)',
    ]);
  });

  it('leaves next week’s published plan and draft too', async () => {
    for (const publish of [true, false]) {
      const h = await published();
      const drafted = await draftPlan(h.head, { week: nextWeek });
      if (!drafted.ok || !drafted.planned) throw new Error('Not drafted');
      await h.inIt((tx) =>
        tx
          .update(assignments)
          .set({ memberId: h.alex })
          .where(eq(assignments.planId, drafted.planId)),
      );
      const before = await h.plan(nextWeek);
      if (publish) await publishPlan(h.head, { week: nextWeek, version: before?.version });
      expect(await leave(h.adult)).toEqual({ ok: true });
      const after = await h.plan(nextWeek);
      expect(new Set(after?.rows.map((row) => row.member))).toEqual(new Set(['Robin']));
      expect(new Set(after?.rows.map((row) => row.reason))).toEqual(
        new Set([publish ? 're-allocated: member unavailable' : 'only eligible member']),
      );
      // A draft drafted again moves on a version, so a head publishes it as it is now.
      if (!publish) expect(after?.version).toBeGreaterThan(before?.version ?? 0);
    }
  });

  it('counts their fair portion of the week up to the moment they left', async () => {
    const h = await published();
    expect(await leave(h.adult)).toEqual({ ok: true });
    h.clock.advance({ hours: 96 });
    expect(await settlePlanWeek(h.scheduler, { week: thisWeek })).toEqual({
      ok: true,
      settled: true,
    });
    const entries = await h.inIt((tx) =>
      tx
        .select({ member: ledgerEntries.memberId, change: ledgerEntries.change })
        .from(ledgerEntries),
    );
    const change = new Map(entries.map((e) => [e.member, e.change]));
    // The plan is for Thursday on, 96 hours, all at home; Alex was there for 11 of them, Robin for
    // all, and nobody did the 80 points of dishes yet.
    expect(change.get(h.alex)).toBeCloseTo((-80 * 11) / 107, 6);
    expect(change.get(h.robin)).toBeCloseTo((-80 * 96) / 107, 6);
  });

  it('removes their answers, and their days away once no settlement needs them', async () => {
    const h = await published();
    const [harder, easier] = [
      await h.task('Windows', 15, 'weekly', '2026-10-09'),
      await h.task('Oven', 30, 'monthly', '2026-10-09'),
    ];
    await h.inIt((tx) =>
      tx.insert(comparisons).values({
        householdId: h.householdId,
        memberId: h.alex,
        harderTaskId: harder,
        easierTaskId: easier,
        answeredAt: new Date('2026-10-07T10:00:00Z'),
      }),
    );
    // Away on Monday and from today to Friday, and next week; can't today too.
    await h.absent(h.alex, '2026-10-05', '2026-10-05');
    await h.absent(h.alex, '2026-10-08', '2026-10-09');
    await h.absent(h.alex, '2026-10-13', '2026-10-14');
    expect(await reportUnavailable(h.adult, { member: h.alex, lastDay: '2026-10-08' })).toEqual({
      ok: true,
    });
    h.clock.advance({ minutes: 30 });
    const days = () =>
      h.inIt((tx) =>
        tx.select({ first: absences.firstDay }).from(absences).orderBy(absences.firstDay),
      );
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await h.inIt((tx) => tx.select().from(comparisons))).toEqual([]);
    expect(await days()).toEqual([{ first: '2026-10-05' }, { first: '2026-10-08' }]);
    expect(await h.inIt((tx) => tx.select().from(unavailabilities))).toHaveLength(1);
    h.clock.advance({ hours: 96 });
    await settlePlanWeek(h.scheduler, { week: thisWeek });
    expect(await days()).toEqual([]);
    expect(await h.inIt((tx) => tx.select().from(unavailabilities))).toEqual([]);
  });

  it('deletes a profile with nothing to keep, as of a household that hasn’t started', async () => {
    const h = await plannedHousehold(db, { started: null });
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await alexRow(h)).toBeUndefined();
  });

  it('keeps their membership of another household', async () => {
    const h = await published();
    const accountId = (await alexRow(h))?.accountId;
    if (!accountId) throw new Error('No account');
    const other = await plannedHousehold(db);
    await other.inIt((tx) =>
      tx
        .insert(members)
        .values({ householdId: other.householdId, name: 'Alex', role: 'adult', accountId }),
    );
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await membership({ db }, accountId, other.householdId)).not.toBeNull();
  });

  it('is for the member themselves, never a child', async () => {
    const h = await published();
    expect(await leave({ ...h.adult, member: { ...h.adult.member, role: 'child' } })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await leave({ ...h.adult, member: { ...h.adult.member, hasAccount: false } })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await leaveHousehold(h.adult, { shownAs: 'nickname' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await alexRow(h)).toMatchObject({ leftAt: null });
    // A head who isn't the last can leave.
    await h.inIt((tx) => tx.update(members).set({ role: 'head' }).where(eq(members.id, h.alex)));
    expect(await leave(h.head)).toEqual({ ok: true });
    // Once gone, they can't leave again.
    expect(await leave(h.head)).toEqual({ ok: false, error: 'not-allowed' });
  });
});

/** Adds a member to `h` who joined on `joinedAt`, with an account of their own if `account`. */
const addMember = async (
  h: PlannedHousehold,
  name: string,
  { role = 'adult', account = true, joinedAt = '2026-10-02T00:00:00Z' } = {},
) => {
  const accountId = account
    ? (
        await db
          .insert(accounts)
          .values({ name, email: `${name}-${crypto.randomUUID()}@example.org`, culture: 'en-BE' })
          .returning({ id: accounts.id })
      )[0]?.id
    : undefined;
  const [row] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({
        householdId: h.householdId,
        name,
        role: role as 'adult' | 'child',
        birthDate: role === 'child' ? '2016-03-01' : null,
        accountId,
        joinedAt: new Date(joinedAt),
      })
      .returning({ id: members.id }),
  );
  if (!row) throw new Error('No member');
  return row.id;
};

/** Each current member's name and role, and whether they were named head, by name. */
const roles = async (h: PlannedHousehold) =>
  (
    await h.inIt((tx) =>
      tx
        .select({ name: members.name, role: members.role, namedHead: members.namedHead })
        .from(members)
        .where(isNull(members.leftAt)),
    )
  ).sort((a, b) => a.name.localeCompare(b.name));

describe('leaveHousehold, as the last head (ADR-0018 §2, clarification)', () => {
  it('passes the role at once to the adult they name, who is asked later', async () => {
    const h = await published();
    await addMember(h, 'Sam', { joinedAt: '2026-10-02T00:00:00Z' });
    expect(await leaveHousehold(h.head, { shownAs: 'name', successor: h.alex })).toEqual({
      ok: true,
    });
    expect(await roles(h)).toEqual([
      { name: 'Alex', role: 'head', namedHead: true },
      { name: 'Sam', role: 'adult', namedHead: false },
    ]);
    // Robin left all the same, and nothing is logged (ADR-0018 §8).
    const view = await viewHousehold(h.adult);
    expect(view.ok && view.members.map((m) => m.name)).toEqual(['Alex', 'Sam']);
    expect(await h.inIt((tx) => tx.select().from(activityLog))).toEqual([]);
  });

  it('passes it to the adult with an account longest in the household when they name no one', async () => {
    const h = await published();
    // Sam's profile is older than Alex's, though their account was linked later; Kim has no account
    // and Jo is a child, so neither can be head.
    const sam = await addMember(h, 'Sam', { joinedAt: '2026-09-01T00:00:00Z' });
    await addMember(h, 'Kim', { account: false, joinedAt: '2026-01-01T00:00:00Z' });
    await addMember(h, 'Jo', { role: 'child', joinedAt: '2026-01-01T00:00:00Z' });
    expect(await leave(h.head)).toEqual({ ok: true });
    expect((await roles(h)).filter(({ role }) => role === 'head')).toEqual([
      { name: 'Sam', role: 'head', namedHead: false },
    ]);
    // Sam acts as head once their account has two factors (ADR-0010 §3).
    const [account] = await h.inIt((tx) =>
      tx.select({ id: members.accountId }).from(members).where(eq(members.id, sam)),
    );
    if (!account?.id) throw new Error('No account');
    expect(await membership({ db }, account.id, h.householdId)).toMatchObject({
      role: 'head',
      twoFactor: false,
    });
  });

  it('orders profiles added at the same moment by their id, so the same one always gets it', async () => {
    const h = await published();
    const sam = await addMember(h, 'Sam', { joinedAt: '2026-10-01T00:00:00Z' });
    const first = [h.alex, sam].sort()[0];
    expect(await leave(h.head)).toEqual({ ok: true });
    const [head] = await h.inIt((tx) =>
      tx.select({ id: members.id }).from(members).where(eq(members.role, 'head')),
    );
    expect(head?.id).toBe(first);
  });

  it('can only name a current adult with an account', async () => {
    const h = await published();
    const kim = await addMember(h, 'Kim', { account: false });
    const jo = await addMember(h, 'Jo', { role: 'child' });
    for (const successor of [kim, jo, h.robin, crypto.randomUUID()]) {
      expect(await leaveHousehold(h.head, { shownAs: 'name', successor })).toEqual({
        ok: false,
        error: 'successor',
      });
    }
    expect(await leaveHousehold(h.head, { shownAs: 'name', successor: 'Alex' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    // Alex has gone meanwhile; Sam is still there to name.
    await addMember(h, 'Sam');
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await leaveHousehold(h.head, { shownAs: 'name', successor: h.alex })).toEqual({
      ok: false,
      error: 'successor',
    });
    expect((await roles(h)).find(({ name }) => name === 'Robin')).toMatchObject({ role: 'head' });
  });

  it('is refused for now when no adult with an account is left, which would close the household', async () => {
    const h = await published();
    await addMember(h, 'Kim', { account: false });
    expect(await leave(h.adult)).toEqual({ ok: true });
    expect(await leave(h.head)).toEqual({ ok: false, error: 'last-adult' });
    expect((await roles(h)).find(({ name }) => name === 'Robin')).toMatchObject({ role: 'head' });
  });

  it('passes nothing on when another head stays, whoever they named', async () => {
    const h = await published();
    await h.inIt((tx) => tx.update(members).set({ role: 'head' }).where(eq(members.id, h.alex)));
    const sam = await addMember(h, 'Sam');
    expect(await leaveHousehold(h.head, { shownAs: 'name', successor: sam })).toEqual({
      ok: true,
    });
    expect(await roles(h)).toEqual([
      { name: 'Alex', role: 'head', namedHead: false },
      { name: 'Sam', role: 'adult', namedHead: false },
    ]);
  });

  it('leaves a named head who leaves in turn as an ordinary former member', async () => {
    const h = await published();
    await addMember(h, 'Sam');
    await leaveHousehold(h.head, { shownAs: 'name', successor: h.alex });
    const asHead = { ...h.adult, member: { ...h.adult.member, role: 'head' as const } };
    expect(await leave(asHead)).toEqual({ ok: true });
    expect(await alexRow(h)).toMatchObject({ role: 'head', namedHead: false });
    expect(await roles(h)).toEqual([{ name: 'Sam', role: 'head', namedHead: false }]);
  });
});

describe('leaveOptions (ADR-0018 §2, §8)', () => {
  it('gives the household, the member’s name and the support line of its country', async () => {
    const h = await plannedHousehold(db);
    expect(await leaveOptions(h.adult)).toEqual({
      ok: true,
      household: 'Ash Lane',
      name: 'Alex',
      successors: null,
      support: { name: '1712', phone: '1712', website: 'https://www.1712.be' },
    });
  });

  it('gives the last head who can become head, longest in the household first', async () => {
    const h = await plannedHousehold(db);
    expect(await leaveOptions(h.head)).toMatchObject({
      ok: true,
      successors: [{ id: h.alex, name: 'Alex' }],
    });
    const sam = await addMember(h, 'Sam', { joinedAt: '2026-09-01T00:00:00Z' });
    await addMember(h, 'Kim', { account: false, joinedAt: '2026-01-01T00:00:00Z' });
    expect(await leaveOptions(h.head)).toMatchObject({
      successors: [
        { id: sam, name: 'Sam' },
        { id: h.alex, name: 'Alex' },
      ],
    });
    await leave(h.adult);
    await h.inIt((tx) => tx.delete(members).where(eq(members.id, sam)));
    expect(await leaveOptions(h.head)).toMatchObject({ successors: [] });
  });

  it('has no support line yet for a country without one', async () => {
    const h = await plannedHousehold(db, { country: 'DE', timeZone: 'Europe/Berlin' });
    expect(await leaveOptions(h.adult)).toMatchObject({ ok: true, support: null });
  });

  it('is not for a child, nor for someone who left', async () => {
    const h = await plannedHousehold(db);
    expect(
      await leaveOptions({ ...h.adult, member: { ...h.adult.member, role: 'child' } }),
    ).toEqual({ ok: false, error: 'not-allowed' });
    await leave(h.adult);
    expect(await leaveOptions(h.adult)).toEqual({ ok: false, error: 'not-allowed' });
  });
});
