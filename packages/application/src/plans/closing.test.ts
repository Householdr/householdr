import { completions, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { closeDueOccurrences } from './closing';
import { draftPlan } from './draft-plan';
import { publishPlan } from './publish-plan';
import { plannedHousehold, type PlannedHousehold } from './testing';
import { viewPlan } from './view-plan';

// What a week no longer carries over closes as missed when the week it would roll into begins, and
// not before: until then it is its own week's work, to be done in that week (ADR-0002 §2, ADR-0006
// §4, clarifications). On a real database, with a clock the tests set (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, and the next. The households are in Brussels.
const week1 = '2026-10-12';
const week2 = '2026-10-19';
const saturday = '2026-10-17T08:00:00Z';
const sunday = '2026-10-18T08:00:00Z';
const week2Begins = '2026-10-18T22:00:00Z';

/** Moves the household's clock on to `iso`. */
const at = (h: PlannedHousehold, iso: string) => {
  h.clock.advance(Temporal.Instant.from(iso).since(h.clock.now()));
};

/**
 * A household past setup whose week 1 is drafted and published, with `tasks` added first, and
 * whose week 2 is drafted on Saturday of week 1, at its draft time.
 */
const twoWeeks = async (tasks: (h: PlannedHousehold) => Promise<unknown>) => {
  const h = await plannedHousehold(db);
  await tasks(h);
  await draftPlan(h.scheduler, { week: week1 });
  await publishPlan(h.scheduler, { week: week1 });
  at(h, saturday);
  const drafted = await draftPlan(h.scheduler, { week: week2 });
  if (!drafted.ok || !drafted.planned) throw new Error('Week 2 not drafted');
  return { h, week2Plan: drafted.planId };
};

/** The occurrence of `task` on `date`. */
const occurrence = async (h: PlannedHousehold, task: string, date: string) => {
  const found = (await h.occurrences()).find((o) => o.task === task && o.date === date);
  if (!found) throw new Error(`No ${task} on ${date}`);
  return found;
};

/** Robin marks the occurrence of `task` on `date` done, as having done it. */
const done = async (h: PlannedHousehold, task: string, date: string) =>
  completeOccurrence(h.head, { occurrence: (await occurrence(h, task, date)).id });

describe('closing when the week it rolls into begins (ADR-0002 §2, clarifications)', () => {
  it('keeps a lapsing Sunday task open and completable after next week’s draft, then closes it', async () => {
    const { h, week2Plan } = await twoWeeks(async (h) => {
      await h.task('Bins', 5, 'weekly', '2026-10-18', 'lapse');
      await h.task('Plants', 10, 'weekly', '2026-10-18', 'lapse');
    });
    // Drafting week 2 on Saturday closes nothing: both are still week 1's work.
    expect(await occurrence(h, 'Bins', '2026-10-18')).toMatchObject({
      status: 'open',
      closedByPlan: week2Plan,
    });
    at(h, sunday);
    expect(await done(h, 'Bins', '2026-10-18')).toMatchObject({ ok: true });
    // Not before 00:00 on Monday in Brussels.
    at(h, '2026-10-18T21:59:00Z');
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 0 });
    at(h, week2Begins);
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 1 });
    expect(await occurrence(h, 'Bins', '2026-10-18')).toMatchObject({ status: 'done' });
    expect(await occurrence(h, 'Plants', '2026-10-18')).toMatchObject({
      status: 'missed',
      closedByPlan: week2Plan,
    });
    expect(await done(h, 'Plants', '2026-10-18')).toEqual({ ok: false, error: 'closed' });
  });

  it('leaves Saturday’s dishes, which next week’s replace, to do until the week ends', async () => {
    const { h } = await twoWeeks((h) => h.task('Dishes', 20, 'daily', '2026-10-08'));
    expect(await done(h, 'Dishes', '2026-10-17')).toMatchObject({ ok: true });
    at(h, sunday);
    expect(await done(h, 'Dishes', '2026-10-18')).toMatchObject({ ok: true });
    at(h, week2Begins);
    // The five days nobody did close; the two done stay done.
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 5 });
    const week1Dishes = (await h.occurrences()).filter((o) => o.date < week2);
    expect(week1Dishes.map((o) => [o.date, o.status])).toEqual([
      ['2026-10-12', 'missed'],
      ['2026-10-13', 'missed'],
      ['2026-10-14', 'missed'],
      ['2026-10-15', 'missed'],
      ['2026-10-16', 'missed'],
      ['2026-10-17', 'done'],
      ['2026-10-18', 'done'],
    ]);
    expect(await done(h, 'Dishes', '2026-10-16')).toEqual({ ok: false, error: 'closed' });
  });

  it('shows a roll-over done on Sunday in next week’s published plan as done, and no work there', async () => {
    const { h, week2Plan } = await twoWeeks((h) => h.task('Windows', 15, 'biweekly', '2026-10-14'));
    await publishPlan(h.scheduler, { week: week2 });
    const windows = await occurrence(h, 'Windows', '2026-10-14');
    // Carried over into week 2, and still week 1's to do.
    expect((await h.plan(week2))?.rows).toEqual([
      expect.objectContaining({ occurrence: windows.id, status: 'open' }),
    ]);
    at(h, sunday);
    expect(await completeOccurrence(h.head, { occurrence: windows.id, doers: [h.alex] })).toEqual(
      expect.objectContaining({ ok: true }),
    );
    // Its completion belongs to week 1's plan; week 2's assignment of it is superseded.
    const [completion] = await h.inIt((tx) =>
      tx.select({ planId: completions.planId }).from(completions),
    );
    const week1Plan = (await h.plan(week1))?.id;
    expect(completion?.planId).toBe(week1Plan);
    expect(completion?.planId).not.toBe(week2Plan);

    const shown = await viewPlan(h.adult);
    if (!shown.ok) throw new Error('Not shown');
    const inWeek2 = shown.nextWeek?.members.flatMap((m) => m.assignments) ?? [];
    expect(inWeek2).toHaveLength(1);
    expect(inWeek2[0]).toMatchObject({
      task: 'Windows',
      completable: false,
      // Not this week's work, not even for whoever it went to.
      cost: null,
      completion: { day: Temporal.PlainDate.from('2026-10-18'), doers: [{ name: 'Alex' }] },
    });
    at(h, week2Begins);
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 0 });
    expect(await occurrence(h, 'Windows', '2026-10-14')).toMatchObject({ status: 'done' });
  });

  it('carries a roll-over nobody did into next week, where it can be done', async () => {
    const { h } = await twoWeeks((h) => h.task('Windows', 15, 'biweekly', '2026-10-14'));
    await publishPlan(h.scheduler, { week: week2 });
    at(h, week2Begins);
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 0 });
    at(h, '2026-10-20T08:00:00Z');
    const shown = await viewPlan(h.head);
    if (!shown.ok) throw new Error('Not shown');
    const [carried] = shown.thisWeek?.members.flatMap((m) => m.assignments) ?? [];
    expect(carried).toMatchObject({ task: 'Windows', completable: true });
    expect(carried?.date.toString()).toBe('2026-10-14');
    expect(await done(h, 'Windows', '2026-10-14')).toMatchObject({ ok: true });
    const [completion] = await h.inIt((tx) =>
      tx.select({ planId: completions.planId }).from(completions),
    );
    expect(completion?.planId).toBe((await h.plan(week2))?.id);
  });

  it('closes nothing twice, and a draft drafted again reopens nothing', async () => {
    const { h, week2Plan } = await twoWeeks((h) => h.task('Vacuum', 30, 'weekly', '2026-10-14'));
    // A head drafts week 2 again: the same marks, and nothing reopened or lost.
    const before = await h.occurrences();
    await draftPlan(h.head, { week: week2 });
    expect(await h.occurrences()).toEqual(before);
    at(h, week2Begins);
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 1 });
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 0 });
    // Once week 2 has begun, its vacuuming moves to every other week from 21 October, so week 2
    // would no longer replace week 1's: drafted again, the one it closed stays closed all the same.
    await h.inIt(async (tx) => {
      const [task] = await tx.select({ schedule: tasks.scheduleId }).from(tasks);
      if (!task) throw new Error('No task');
      await tx
        .update(schedules)
        .set({ rules: [{ rrule: 'FREQ=WEEKLY;INTERVAL=2', start: '2026-10-28' }] })
        .where(eq(schedules.id, task.schedule));
    });
    await draftPlan(h.head, { week: week2 });
    expect(await occurrence(h, 'Vacuum', '2026-10-14')).toMatchObject({
      status: 'missed',
      closedByPlan: week2Plan,
    });
    expect((await h.plan(week2))?.rows).toEqual([]);
  });

  it('opens again what a begun week closed, if it turns out away all week (ADR-0005 §5)', async () => {
    const { h } = await twoWeeks((h) => h.task('Vacuum', 30, 'weekly', '2026-10-14'));
    at(h, week2Begins);
    await closeDueOccurrences(h.scheduler);
    await h.away(week2, '2026-10-25');
    expect(await draftPlan(h.head, { week: week2 })).toEqual({ ok: true, planned: false });
    expect(await h.plan(week2)).toBeUndefined();
    // Week 2 has no plan to replace it: it rolls on, for the next planned week to deal with.
    expect(await occurrence(h, 'Vacuum', '2026-10-14')).toMatchObject({
      status: 'open',
      closedByPlan: null,
    });
  });

  it('closes what is due before drafting, so a late close never leaves it in the pool', async () => {
    const { h } = await twoWeeks((h) => h.task('Vacuum', 30, 'weekly', '2026-10-14'));
    await publishPlan(h.scheduler, { week: week2 });
    // No closing step ran when week 2 began; week 3 is drafted on its Saturday.
    at(h, '2026-10-24T08:00:00Z');
    await draftPlan(h.scheduler, { week: '2026-10-26' });
    expect(await occurrence(h, 'Vacuum', '2026-10-14')).toMatchObject({ status: 'missed' });
    expect((await h.plan('2026-10-26'))?.rows.map((row) => row.date)).toEqual(['2026-10-28']);
  });

  it('is the scheduler’s alone', async () => {
    const h = await plannedHousehold(db);
    expect(await closeDueOccurrences(h.head)).toEqual({ ok: false, error: 'not-allowed' });
  });
});
