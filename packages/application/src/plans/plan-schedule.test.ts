import { jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settlePlanWeek } from '../ledger/settle-plan-week';
import { settableClock, settableFlags } from '../testing';
import { closeDueOccurrences } from './closing';
import { draftPlan } from './draft-plan';
import { queueDuePlanSteps } from './plan-schedule';
import { publishPlan } from './publish-plan';
import { plannedHousehold, type PlannedHousehold } from './testing';

// The scheduler's tick (ADR-0006 §2, ADR-0008 §10): which households' plan steps are due, in their
// own time zones, queued once each, on a real database and queue (TEST-11).

let db: Database;
let close: () => Promise<void>;
let queue: JobQueue;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
  queue = await jobQueue(db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await close();
});

/**
 * Ticks at `at`, with the flags at their defaults (TEST-9), and returns the steps waiting for
 * `households`, by household and week.
 */
const tick = async (at: string, ...households: PlannedHousehold[]) => {
  const clock = settableClock(Temporal.Instant.from(at));
  await queueDuePlanSteps({ db, clock, queue, flags: settableFlags() });
  const ids = new Set(households.map((h) => h.householdId));
  const waiting = async (name: 'plan-draft' | 'plan-publish' | 'plan-close') =>
    (await queue.fetch<Jobs[typeof name]>(name, { batchSize: 100 }))
      .filter((job) => ids.has(job.data.household))
      .map((job) => [name, job.data.household, job.data.week]);
  return [
    ...(await waiting('plan-draft')),
    ...(await waiting('plan-publish')),
    ...(await waiting('plan-close')),
  ];
};

// The week of Monday 12 October 2026 is drafted from Saturday 10 October 00:00 in Brussels and
// published from Sunday 11 October 12:00.
const beforeDraft = '2026-10-09T21:59:00Z';
const draftTime = '2026-10-09T22:00:00Z';
const publishTime = '2026-10-11T10:00:00Z';

describe('queueDuePlanSteps (ADR-0006 §2, ADR-0008 §10)', () => {
  it('queues the next week’s draft once its draft time has come, and not before', async () => {
    const h = await plannedHousehold(db);
    expect(await tick(beforeDraft, h)).toEqual([]);
    expect(await tick(draftTime, h)).toEqual([['plan-draft', h.householdId, '2026-10-12']]);
  });

  it('queues a step once, however often it ticks while the step waits (CODE-19)', async () => {
    const h = await plannedHousehold(db);
    const clock = settableClock(Temporal.Instant.from(draftTime));
    const flags = settableFlags();
    expect(await queueDuePlanSteps({ db, clock, queue, flags })).toBeGreaterThanOrEqual(1);
    clock.advance({ minutes: 1 });
    await queueDuePlanSteps({ db, clock, queue, flags });
    expect(await tick(draftTime, h)).toEqual([['plan-draft', h.householdId, '2026-10-12']]);
  });

  it('queues the draft’s publishing once its publish time has come, then nothing', async () => {
    const h = await plannedHousehold(db);
    await draftPlan(h.scheduler, { week: '2026-10-12' });
    expect(await tick(draftTime, h)).toEqual([]);
    expect(await tick(publishTime, h)).toEqual([['plan-publish', h.householdId, '2026-10-12']]);
    await publishPlan(h.scheduler, { week: '2026-10-12' });
    expect(await tick(publishTime, h)).toEqual([]);
  });

  it('catches up on a week begun without its plan published, as after a stop (§2, clarification)', async () => {
    const h = await plannedHousehold(db);
    await draftPlan(h.scheduler, { week: '2026-10-12' });
    // Tuesday 13 October: the scheduler missed Sunday's publish time.
    expect(await tick('2026-10-13T08:00:00Z', h)).toEqual([
      ['plan-publish', h.householdId, '2026-10-12'],
    ]);
    await publishPlan(h.scheduler, { week: '2026-10-12' });
    expect(await tick('2026-10-13T08:01:00Z', h)).toEqual([]);
  });

  it('catches up on a week begun with no plan at all, drafting it first (§2, clarification)', async () => {
    const h = await plannedHousehold(db);
    expect(await tick('2026-10-13T08:00:00Z', h)).toEqual([
      ['plan-draft', h.householdId, '2026-10-12'],
    ]);
  });

  it('leaves the draft of a household that started now for a head to publish (ADR-0007 §3)', async () => {
    const h = await plannedHousehold(db, { startedNow: true });
    await draftPlan(h.scheduler, { week: '2026-10-12' });
    expect(await tick('2026-10-13T08:00:00Z', h)).toEqual([]);
  });

  it('queues nothing for a household in setup, or before its first plan week (ADR-0007 §2)', async () => {
    const inSetup = await plannedHousehold(db, { started: null });
    const later = await plannedHousehold(db, { started: '2026-10-19' });
    expect(await tick(publishTime, inSetup, later)).toEqual([]);
  });

  it('queues nothing for a week the household is away for entirely (ADR-0005 §5)', async () => {
    const h = await plannedHousehold(db);
    await h.away('2026-10-12', '2026-10-18');
    expect(await tick(publishTime, h)).toEqual([]);
  });

  it('follows each household’s own time zone', async () => {
    const brussels = await plannedHousehold(db);
    const lisbon = await plannedHousehold(db, { timeZone: 'Europe/Lisbon', country: 'PT' });
    // 23:30 on Friday in Lisbon, and already Saturday in Brussels.
    expect(await tick('2026-10-09T22:30:00Z', brussels, lisbon)).toEqual([
      ['plan-draft', brussels.householdId, '2026-10-12'],
    ]);
    expect(await tick('2026-10-09T23:00:00Z', lisbon)).toEqual([
      ['plan-draft', lisbon.householdId, '2026-10-12'],
    ]);
  });

  it('queues closing what a week no longer carries over once it begins, in each time zone', async () => {
    const brussels = await plannedHousehold(db);
    const lisbon = await plannedHousehold(db, { timeZone: 'Europe/Lisbon', country: 'PT' });
    // Vacuuming on Wednesdays: week 2's replaces week 1's, which closes as week 2 begins.
    for (const h of [brussels, lisbon]) {
      await h.task('Vacuum', 30, 'weekly', '2026-10-14');
      await draftPlan(h.scheduler, { week: '2026-10-12' });
      await publishPlan(h.scheduler, { week: '2026-10-12' });
      h.clock.advance({ hours: 9 * 24 });
      await draftPlan(h.scheduler, { week: '2026-10-19' });
      await publishPlan(h.scheduler, { week: '2026-10-19' });
    }
    // Sunday 23:00 in Brussels, 22:00 in Lisbon: nothing to close yet.
    expect(await tick('2026-10-18T21:00:00Z', brussels, lisbon)).toEqual([]);
    // 00:30 on Monday in Brussels, still 23:30 on Sunday in Lisbon.
    expect(await tick('2026-10-18T22:30:00Z', brussels, lisbon)).toEqual([
      ['plan-close', brussels.householdId, '2026-10-19'],
    ]);
    // Queued once, however often it ticks while the step waits or runs (CODE-19).
    expect(await tick('2026-10-18T22:31:00Z', brussels)).toEqual([]);
    expect(await tick('2026-10-18T23:00:00Z', lisbon)).toEqual([
      ['plan-close', lisbon.householdId, '2026-10-19'],
    ]);
  });

  it('queues no closing once what was due is closed', async () => {
    const h = await plannedHousehold(db);
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await draftPlan(h.scheduler, { week: '2026-10-12' });
    await publishPlan(h.scheduler, { week: '2026-10-12' });
    h.clock.advance({ hours: 9 * 24 });
    await draftPlan(h.scheduler, { week: '2026-10-19' });
    // Published at its time, so there's nothing to catch up on either (ADR-0006 §2, clarification).
    await publishPlan(h.scheduler, { week: '2026-10-19' });
    h.clock.advance({ hours: 2 * 24 });
    expect(await closeDueOccurrences(h.scheduler)).toEqual({ ok: true, closed: 1 });
    expect(await tick('2026-10-19T08:00:00Z', h)).toEqual([]);
  });

  describe('settling a week once it is over (ADR-0002 §1, §7)', () => {
    /** Ticks at `at` with the balances' flag on, and returns the settling waiting for `households`. */
    const settling = async (at: string, ...households: PlannedHousehold[]) => {
      const clock = settableClock(Temporal.Instant.from(at));
      await queueDuePlanSteps({ db, clock, queue, flags: settableFlags({ balances: true }) });
      const ids = new Set(households.map((h) => h.householdId));
      return (await queue.fetch<Jobs['plan-settle']>('plan-settle', { batchSize: 100 }))
        .filter((job) => ids.has(job.data.household))
        .map((job) => [job.data.household, job.data.week]);
    };

    /** A household whose week 1 plan is published, with `publish` false a draft only. */
    const withWeek1 = async (
      options: Parameters<typeof plannedHousehold>[1] = {},
      publish = true,
    ) => {
      const h = await plannedHousehold(db, options);
      await h.task('Vacuum', 30, 'weekly', '2026-10-14');
      await draftPlan(h.scheduler, { week: '2026-10-12' });
      if (publish) await publishPlan(h.scheduler, { week: '2026-10-12' });
      return h;
    };

    it('queues it once the next week has begun, in each household’s time zone, once', async () => {
      const brussels = await withWeek1();
      const lisbon = await withWeek1({ timeZone: 'Europe/Lisbon', country: 'PT' });
      // Sunday 23:59 in Brussels: week 1 isn't over anywhere.
      expect(await settling('2026-10-18T21:59:00Z', brussels, lisbon)).toEqual([]);
      // 00:30 on Monday in Brussels, still 23:30 on Sunday in Lisbon.
      expect(await settling('2026-10-18T22:30:00Z', brussels, lisbon)).toEqual([
        [brussels.householdId, '2026-10-12'],
      ]);
      // Queued once, however often it ticks while the step waits or runs (CODE-19).
      expect(await settling('2026-10-18T22:31:00Z', brussels)).toEqual([]);
      expect(await settling('2026-10-18T23:00:00Z', lisbon)).toEqual([
        [lisbon.householdId, '2026-10-12'],
      ]);
    });

    it('queues nothing once the week is settled, or for a draft never published', async () => {
      const settled = await withWeek1();
      const draft = await withWeek1({}, false);
      settled.clock.advance({ hours: 11 * 24 });
      expect(await settlePlanWeek(settled.scheduler, { week: '2026-10-12' })).toEqual({
        ok: true,
        settled: true,
      });
      expect(await settling('2026-10-19T08:00:00Z', settled, draft)).toEqual([]);
    });

    it('queues nothing while the balances’ release flag is off (CODE-20)', async () => {
      const h = await withWeek1();
      // Week 2 is caught up on, as when the scheduler was down, but week 1 isn't settled.
      expect(await tick('2026-10-19T08:00:00Z', h)).toEqual([
        ['plan-draft', h.householdId, '2026-10-19'],
      ]);
      const waiting = await queue.fetch<Jobs['plan-settle']>('plan-settle', { batchSize: 100 });
      expect(waiting.filter((job) => job.data.household === h.householdId)).toEqual([]);
    });
  });
});
