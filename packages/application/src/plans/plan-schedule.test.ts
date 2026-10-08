import { jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settableClock } from '../testing';
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

/** Ticks at `at`, and returns the steps waiting for `households`, by household and week. */
const tick = async (at: string, ...households: PlannedHousehold[]) => {
  const clock = settableClock(Temporal.Instant.from(at));
  await queueDuePlanSteps({ db, clock, queue });
  const ids = new Set(households.map((h) => h.householdId));
  const waiting = async (name: 'plan-draft' | 'plan-publish') =>
    (await queue.fetch<Jobs[typeof name]>(name, { batchSize: 100 }))
      .filter((job) => ids.has(job.data.household))
      .map((job) => [name, job.data.household, job.data.week]);
  return [...(await waiting('plan-draft')), ...(await waiting('plan-publish'))];
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
    expect(await queueDuePlanSteps({ db, clock, queue })).toBeGreaterThanOrEqual(1);
    clock.advance({ minutes: 1 });
    await queueDuePlanSteps({ db, clock, queue });
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
});
