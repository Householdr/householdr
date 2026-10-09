import {
  addTask,
  completeOccurrence,
  createHousehold,
  draftPlan,
  publishPlan,
  viewPlan,
  type Database,
  type Jobs,
} from '@householdr/application';
import { recordingMailer, settableClock, settableFlags } from '@householdr/application/testing';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workQueues, type WorkerContext } from './index';
import { closeScheduledOccurrences, draftScheduledPlan, tickPlans } from './plans';

// The plans' jobs, from the tick to a published plan (ADR-0006 §2, ADR-0008 §10), on a real
// database and queue (TEST-11), behind the plans' flag (CODE-20).

let test: Awaited<ReturnType<typeof testSignInContext>>;
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household past setup from the week of Monday 12 October 2026, and its head's context. */
const started = async (db: Database, clock: WorkerContext['clock']) => {
  const account = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  await startTestHousehold(db, created.householdId, '2026-10-12');
  const head = { id: created.memberId, role: 'head' as const, hasAccount: true, twoFactor: true };
  return {
    householdId: created.householdId,
    head: { db, clock, householdId: created.householdId, member: head },
  };
};

/** The status of next week's plan, as its head sees it. */
const nextWeek = async (head: Parameters<typeof viewPlan>[0]) => {
  const result = await viewPlan(head);
  return result.ok ? (result.nextWeek?.status ?? null) : result.error;
};

// Saturday 10 October 2026, 00:00 in Brussels: the draft time of the week of 12 October.
const draftTime = '2026-10-09T22:00:00Z';

describe('the plans’ jobs (ADR-0006 §2, ADR-0008 §10)', () => {
  // Each step waits for the queue's next poll, up to four of them two seconds apart.
  it('draft and then publish the next week, from the tick, once each time has come', async () => {
    const clock = settableClock(Temporal.Instant.from(draftTime));
    const context: WorkerContext = {
      ...test.context,
      clock,
      mailer: recordingMailer(),
      flags: settableFlags({ plans: true }),
    };
    const { head } = await started(context.db, clock);
    const queue = await workQueues(context);
    try {
      await queue.send('plan-tick', {});
      await expect.poll(() => nextWeek(head), { timeout: 10_000 }).toBe('draft');
      // Sunday 11 October, 12:00 in Brussels.
      clock.advance({ hours: 36 });
      await queue.send('plan-tick', {});
      await expect.poll(() => nextWeek(head), { timeout: 10_000 }).toBe('published');
    } finally {
      await queue.stop({ graceful: false });
    }
  }, 30_000);

  it('do nothing while the plans’ flag is off (CODE-20)', async () => {
    const clock = settableClock(Temporal.Instant.from(draftTime));
    const off = { ...test.context, clock, flags: settableFlags() };
    const { householdId, head } = await started(off.db, clock);
    const queue = await workQueues({ ...off, mailer: recordingMailer() });
    try {
      await tickPlans({ ...off, queue });
      const waiting = await queue.fetch<Jobs['plan-draft']>('plan-draft', { batchSize: 100 });
      expect(waiting.filter((job) => job.data.household === householdId)).toEqual([]);
      await draftScheduledPlan(off, { household: householdId, week: '2026-10-12' });
      expect(await nextWeek(head)).toBeNull();
    } finally {
      await queue.stop({ graceful: false });
    }
  });

  it('close what a week no longer carries over, once it begins, while the flag is on', async () => {
    // Vacuuming on Wednesdays from 14 October: week 2's replaces week 1's.
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    const { householdId, head } = await started(test.context.db, clock);
    await addTask(head, {
      name: 'Vacuum',
      duration: 30,
      frequency: 'weekly',
      start: '2026-10-14',
      onMiss: 'roll over',
    });
    const scheduler = { db: head.db, clock, householdId, member: 'scheduler' as const };
    await draftPlan(scheduler, { week: '2026-10-12' });
    await publishPlan(scheduler, { week: '2026-10-12' });
    const shown = await viewPlan(head);
    const [vacuum] = (shown.ok && shown.nextWeek?.members.flatMap((m) => m.assignments)) || [];
    if (!vacuum) throw new Error('No vacuuming planned');
    clock.advance({ hours: 9 * 24 });
    await draftPlan(scheduler, { week: '2026-10-19' });
    // Monday 19 October in Brussels: week 2 has begun.
    clock.advance({ hours: 2 * 24 });
    const job = { household: householdId, week: '2026-10-19' };
    const complete = () => completeOccurrence(head, { occurrence: vacuum.occurrence });
    await closeScheduledOccurrences({ ...test.context, clock, flags: settableFlags() }, job);
    // Still open, though no plan of this week has it.
    expect(await complete()).toEqual({ ok: false, error: 'not-this-week' });
    const on = settableFlags({ plans: true });
    await closeScheduledOccurrences({ ...test.context, clock, flags: on }, job);
    expect(await complete()).toEqual({ ok: false, error: 'closed' });
  });
});
