import { assignments, members, unavailabilities, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { endUnavailable, reportUnavailable } from '../availability/unavailability';
import { draftPlan } from './draft-plan';
import { publishPlan } from './publish-plan';
import { plannedHousehold, type PlannedHousehold } from './testing';

// Re-allocating what a member can no longer do once they say they can't today (ADR-0005 §3, with
// its clarification; ADR-0006 §3), on a real database (TEST-11) with a clock the tests set
// (TEST-2). The domain tests the allocator itself; these test which occurrences it is given, from
// what, and what is stored.

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The household's clock reads Thursday 8 October 2026, 10:00 in Brussels; weeks start on Mondays,
// and this one is the household's first.
const week = '2026-10-05';

/**
 * A household whose plan for this week is published, with the dishes every day from today and
 * the windows once, all Alex's: every task on a simple frequency may be done any time this week.
 */
async function published() {
  const h = await plannedHousehold(db, { started: week, startedNow: true });
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  await h.task('Windows', 15, 'weekly', '2026-10-08');
  const drafted = await draftPlan(h.head, { week });
  if (!drafted.ok || !drafted.planned) throw new Error('Not drafted');
  await everything(h, h.alex);
  const plan = await h.plan(week);
  if (!plan) throw new Error('No plan');
  expect(await publishPlan(h.head, { week, version: plan.version })).toEqual({ ok: true });
  h.clock.advance({ hours: 1 });
  return h;
}

/** Gives every occurrence in the household's plans to `memberId`, at its minutes. */
const everything = (h: PlannedHousehold, memberId: string) =>
  h.inIt((tx) => tx.update(assignments).set({ memberId, reason: 'lowest relative load' }));

/** Who has each occurrence of this week's plan, and why: `task date: member (reason)`. */
const whoHas = async (h: PlannedHousehold) => {
  const plan = await h.plan(week);
  return (plan?.rows ?? []).map(
    (row) => `${row.task} ${row.date}: ${row.member ?? '-'} (${row.reason ?? row.cause ?? ''})`,
  );
};

/** Sets the window of `task`'s occurrence on `date` in this week's plan, as a fixed one would have. */
const window = (h: PlannedHousehold, task: string, date: string, start: string, end: string) =>
  h.inIt(async (tx) => {
    const plan = await h.plan(week);
    const row = plan?.rows.find((r) => r.task === task && r.date === date);
    if (!row) throw new Error(`No ${task} on ${date}`);
    await tx
      .update(assignments)
      .set({ windowStart: new Date(start), windowEnd: new Date(end) })
      .where(eq(assignments.occurrenceId, row.occurrence));
  });

const cant = (h: PlannedHousehold, lastDay: string) =>
  reportUnavailable(h.adult, { member: h.alex, lastDay });

describe('re-allocation when a member can’t (ADR-0005 §3)', () => {
  it('moves what they can no longer do this week to someone available, with its reason', async () => {
    const h = await published();
    expect(await cant(h, '2026-10-11')).toEqual({ ok: true });
    const moved = 'Robin (re-allocated: member unavailable)';
    expect(await whoHas(h)).toEqual([
      `Dishes 2026-10-08: ${moved}`,
      `Windows 2026-10-08: ${moved}`,
      `Dishes 2026-10-09: ${moved}`,
      `Dishes 2026-10-10: ${moved}`,
      `Dishes 2026-10-11: ${moved}`,
    ]);
    // At the cost for whoever has it now, with a new version for anyone editing it (ADR-0019 §5).
    const plan = await h.plan(week);
    expect(plan?.rows.map((row) => [row.cost, row.version])).toEqual(
      [20, 15, 20, 20, 20].map((cost) => [cost, 2]),
    );
  });

  it('leaves what they can still do later in the week with them', async () => {
    const h = await published();
    // Bringing the bin in tonight can't wait; the rest can be done from tomorrow.
    await window(h, 'Windows', '2026-10-08', '2026-10-08T16:00:00Z', '2026-10-08T20:00:00Z');
    expect(await cant(h, '2026-10-08')).toEqual({ ok: true });
    expect(await whoHas(h)).toEqual([
      'Dishes 2026-10-08: Alex (lowest relative load)',
      'Windows 2026-10-08: Robin (re-allocated: member unavailable)',
      'Dishes 2026-10-09: Alex (lowest relative load)',
      'Dishes 2026-10-10: Alex (lowest relative load)',
      'Dishes 2026-10-11: Alex (lowest relative load)',
    ]);
  });

  it('gives each only to someone available during what is left of its window', async () => {
    const h = await published();
    // The windows are for today, until 22:00; Robin couldn't from 10:30, half an hour ago.
    await window(h, 'Windows', '2026-10-08', '2026-10-08T06:00:00Z', '2026-10-08T20:00:00Z');
    await h.inIt((tx) =>
      tx.insert(unavailabilities).values({
        householdId: h.householdId,
        memberId: h.robin,
        startsAt: new Date('2026-10-08T08:30:00Z'),
        endsAt: new Date('2026-10-08T22:00:00Z'),
      }),
    );
    expect(await cant(h, '2026-10-08')).toEqual({ ok: true });
    expect(await whoHas(h)).toContain('Windows 2026-10-08: Alex (lowest relative load)');
  });

  it('leaves what nobody else can do, done work and windows gone by with them', async () => {
    const h = await published();
    await h.absent(h.robin, '2026-10-08', '2026-10-11');
    // The windows were for this morning, and the dishes of today are done.
    await window(h, 'Windows', '2026-10-08', '2026-10-08T05:00:00Z', '2026-10-08T07:00:00Z');
    const [today] = (await h.plan(week))?.rows ?? [];
    expect(
      await completeOccurrence(h.adult, { occurrence: today?.occurrence, doers: [h.alex] }),
    ).toMatchObject({ ok: true });
    const before = await h.plan(week);
    expect(await cant(h, '2026-10-11')).toEqual({ ok: true });
    expect(await h.plan(week)).toEqual(before);
  });

  it('moves nothing in a plan that isn’t published yet, or another week’s', async () => {
    const h = await plannedHousehold(db, { started: week, startedNow: true });
    await h.task('Dishes', 20, 'daily', '2026-10-08');
    await draftPlan(h.head, { week });
    await everything(h, h.alex);
    const before = await h.plan(week);
    expect(await cant(h, '2026-10-11')).toEqual({ ok: true });
    expect(await h.plan(week)).toEqual(before);
  });

  it('counts what everyone has in the plan already, by the allocator’s usual rule', async () => {
    const h = await published();
    const [sam] = await h.inIt((tx) =>
      tx
        .insert(members)
        .values({
          householdId: h.householdId,
          name: 'Sam',
          role: 'adult',
          joinedAt: new Date('2026-10-01T00:00:00Z'),
        })
        .returning({ id: members.id }),
    );
    if (!sam) throw new Error('No Sam');
    // Robin has the windows already; Sam, nothing.
    await h.inIt(async (tx) => {
      const plan = await h.plan(week);
      const windows = plan?.rows.find((row) => row.task === 'Windows');
      if (!windows) throw new Error('No windows');
      await tx
        .update(assignments)
        .set({ memberId: h.robin })
        .where(eq(assignments.occurrenceId, windows.occurrence));
    });
    expect(await cant(h, '2026-10-11')).toEqual({ ok: true });
    const loads = new Map<string, number>();
    for (const row of (await h.plan(week))?.rows ?? []) {
      if (row.member) loads.set(row.member, (loads.get(row.member) ?? 0) + (row.cost ?? 0));
    }
    // 95 points between Robin and Sam, as evenly as whole tasks go.
    expect(Object.fromEntries(loads)).toEqual({ Robin: 55, Sam: 40 });
  });

  it('gives nothing to someone who joined after the plan was drafted (ADR-0002 §1)', async () => {
    const h = await published();
    await h.absent(h.robin, '2026-10-08', '2026-10-11');
    await h.inIt((tx) =>
      tx.insert(members).values({ householdId: h.householdId, name: 'Sam', role: 'adult' }),
    );
    const before = await h.plan(week);
    expect(await cant(h, '2026-10-11')).toEqual({ ok: true });
    expect(await h.plan(week)).toEqual(before);
  });

  it('moves what a later end adds, and nothing back when it ends early', async () => {
    const h = await published();
    await window(h, 'Windows', '2026-10-08', '2026-10-09T06:00:00Z', '2026-10-09T10:00:00Z');
    expect(await cant(h, '2026-10-08')).toEqual({ ok: true });
    expect(await whoHas(h)).toContain('Windows 2026-10-08: Alex (lowest relative load)');
    expect(await cant(h, '2026-10-09')).toEqual({ ok: true });
    expect(await whoHas(h)).toContain(
      'Windows 2026-10-08: Robin (re-allocated: member unavailable)',
    );
    const moved = await h.plan(week);
    expect(await endUnavailable(h.adult, { member: h.alex })).toEqual({ ok: true });
    expect(await h.plan(week)).toEqual(moved);
  });

  it('moves a profile’s work when a head says they can’t (ADR-0018 §4)', async () => {
    const h = await published();
    const [noa] = await h.inIt((tx) =>
      tx
        .insert(members)
        .values({
          householdId: h.householdId,
          name: 'Noa',
          role: 'adult',
          joinedAt: new Date('2026-10-01T00:00:00Z'),
        })
        .returning({ id: members.id }),
    );
    if (!noa) throw new Error('No Noa');
    await everything(h, noa.id);
    await h.absent(h.robin, '2026-10-08', '2026-10-11');
    expect(await reportUnavailable(h.head, { member: noa.id, lastDay: '2026-10-11' })).toEqual({
      ok: true,
    });
    const plan = await h.plan(week);
    expect(new Set(plan?.rows.map((row) => `${row.member ?? '-'} (${row.reason ?? ''})`))).toEqual(
      new Set(['Alex (re-allocated: member unavailable)']),
    );
  });
});
