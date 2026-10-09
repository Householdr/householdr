import {
  activityLog,
  households,
  jobQueue,
  members,
  type Database,
  type JobQueue,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { queueDuePlanSteps } from '../plans/plan-schedule';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { viewPlan } from '../plans/view-plan';
import { settableClock } from '../testing';
import { householdActivity } from './activity';
import { viewHousehold } from './membership';
import { startHousehold, startOptions } from './start-household';

// Starting a household, the last step of setting it up (ADR-0007 §2 step 7, §3): now, with this
// week drafted for the days left, or on the week start day, for the scheduler; with one entry in
// the activity log listing what was set for others before (ADR-0018 §5), on a real database
// (TEST-11).

let db: Database;
let owner: Database;
let close: () => Promise<void>;
let queue: JobQueue;
beforeAll(async () => {
  ({ db, owner, close } = await testDatabase());
  queue = await jobQueue(db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await close();
});

// Thursday 8 October 2026: this plan week runs from Monday 5 October, the next from 12 October.
const thisWeek = '2026-10-05';
const nextWeek = '2026-10-12';

/**
 * A household in setup since Monday 5 October, when Robin added its tasks; the clock then reads
 * Thursday 8 October, 10:00 in Brussels. Dishes every day, vacuuming on Wednesdays and the bathroom
 * on Fridays; with `windows`, the windows on Saturdays too; and the fridge once a month, floating.
 */
const inSetup = async ({ windows = false } = {}) => {
  const h = await plannedHousehold(db, { started: null });
  h.clock.advance({ hours: -72 });
  await h.task('Dishes', 20, 'daily', '2026-10-05');
  await h.task('Vacuum', 30, 'weekly', '2026-10-07');
  await h.task('Bathroom', 45, 'weekly', '2026-10-09');
  if (windows) await h.task('Windows', 40, 'weekly', '2026-10-10');
  await h.task('Fridge', 60, 'monthly', '2026-10-05');
  h.clock.advance({ hours: 72 });
  return h;
};

const started = async (h: PlannedHousehold, when: string) => {
  const result = await startHousehold(h.head, { when });
  if (!result.ok) throw new Error(`Not started: ${result.error}`);
  return result;
};

const firstPlanWeek = async (h: PlannedHousehold) => {
  const [row] = await h.inIt((tx) =>
    tx.select({ week: households.firstPlanWeek }).from(households),
  );
  return row?.week;
};

const startedNow = async (h: PlannedHousehold) => {
  const [row] = await h.inIt((tx) => tx.select({ now: households.startedNow }).from(households));
  return row?.now;
};

const entries = (h: PlannedHousehold) =>
  h.inIt((tx) =>
    tx
      .select({
        actorId: activityLog.actorId,
        action: activityLog.action,
        setBeforeStart: activityLog.setBeforeStart,
      })
      .from(activityLog),
  );

/** Adds a profile without an account, named `name`, and returns its id. */
const profile = async (h: PlannedHousehold, name: string) => {
  const [row] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({ householdId: h.householdId, name, role: 'adult' })
      .returning({ id: members.id }),
  );
  if (!row) throw new Error('No profile');
  return row.id;
};

/** The tasks of the plan of `week`, as `[task, date, member]`. */
const rows = async (h: PlannedHousehold, week: string) =>
  ((await h.plan(week))?.rows ?? []).map((row) => [row.task, row.date, row.member]);

describe('startHousehold now (ADR-0007 §3)', () => {
  it('drafts this week for the days left: nothing on the days gone, and the first week recorded', async () => {
    const h = await inSetup();
    expect(await started(h, 'now')).toEqual({
      ok: true,
      when: 'now',
      firstWeek: Temporal.PlainDate.from(thisWeek),
      drafted: true,
    });
    expect(await firstPlanWeek(h)).toBe(thisWeek);
    // Its draft waits for a head to publish it (ADR-0006 §2, clarification).
    expect(await startedNow(h)).toBe(true);
    const plan = await h.plan(thisWeek);
    expect(plan).toMatchObject({ weekEnd: nextWeek, status: 'draft', publishedAt: null });
    expect(plan?.draftedAt).toEqual(new Date('2026-10-08T08:00:00Z'));
    // Monday to Wednesday are gone: neither their dishes nor Wednesday's vacuuming are planned.
    // Four days of dishes and the bathroom make 125 minutes, below the average week (about 229
    // minutes) × 4 / 7 ≈ 131, so the fridge comes in too (ADR-0004 §4).
    expect(plan?.rows.map((row) => [row.task, row.date])).toEqual([
      ['Fridge', '2026-10-05'],
      ['Dishes', '2026-10-08'],
      ['Bathroom', '2026-10-09'],
      ['Dishes', '2026-10-09'],
      ['Dishes', '2026-10-10'],
      ['Dishes', '2026-10-11'],
    ]);
    for (const row of plan?.rows ?? []) expect(row.member).not.toBeNull();
    // Only what the draft holds is stored.
    expect((await h.occurrences()).map((o) => [o.task, o.date])).toEqual(
      plan?.rows.map((row) => [row.task, row.date]),
    );
  });

  it('places a floating task only while the days left are below the scaled average', async () => {
    // Forty minutes of windows on Saturday make 165, over about 269 × 4 / 7 ≈ 154: the fridge
    // waits for a quieter week of its month. A full week's target would have let it in.
    const h = await inSetup({ windows: true });
    await started(h, 'now');
    expect((await rows(h, thisWeek)).map(([task]) => task)).not.toContain('Fridge');
    expect((await rows(h, thisWeek)).map(([task]) => task)).toContain('Windows');
  });

  it('counts fair portions over the days left only (ADR-0005 §5)', async () => {
    // Alex is away for every day left: at home on the days gone, which no longer count, so they
    // get nothing.
    const h = await inSetup();
    await h.absent(h.alex, '2026-10-08', '2026-10-11');
    await started(h, 'now');
    const people = new Set((await rows(h, thisWeek)).map(([, , member]) => member));
    expect(people).toEqual(new Set(['Robin']));
  });

  it('leaves the draft for a head to publish with one tap, with no publish time (ADR-0006 §2)', async () => {
    const h = await inSetup();
    await started(h, 'now');
    const forHead = await viewPlan(h.head);
    if (!forHead.ok) throw new Error('Not shown');
    expect(forHead.thisWeek).toMatchObject({ status: 'draft', version: 1, publishAt: null });
    expect(forHead.nextWeek).toBeNull();
    // Only heads see it until then.
    expect(await viewPlan(h.adult)).toMatchObject({ ok: true, thisWeek: null });
    expect(await publishPlan(h.head, { week: thisWeek, version: 1 })).toEqual({ ok: true });
    expect(await viewPlan(h.adult)).toMatchObject({ thisWeek: { status: 'published' } });
  });

  it('drafts nothing when the household is away for the rest of the week', async () => {
    const h = await inSetup();
    await h.away('2026-10-08', '2026-10-13');
    expect(await started(h, 'now')).toMatchObject({
      firstWeek: Temporal.PlainDate.from(thisWeek),
      drafted: false,
    });
    expect(await h.plan(thisWeek)).toBeUndefined();
  });
});

describe('startHousehold on the week start day (ADR-0007 §3)', () => {
  it('records next week as the first, drafts nothing, and leaves it to the scheduler', async () => {
    const h = await inSetup();
    expect(await started(h, 'week start')).toEqual({
      ok: true,
      when: 'week start',
      firstWeek: Temporal.PlainDate.from(nextWeek),
      drafted: false,
    });
    expect(await firstPlanWeek(h)).toBe(nextWeek);
    expect(await startedNow(h)).toBe(false);
    expect(await h.plan(thisWeek)).toBeUndefined();
    expect(await h.plan(nextWeek)).toBeUndefined();
    expect(await h.occurrences()).toEqual([]);

    // The scheduler drafts it at its draft time, Saturday 10 October 00:00 in Brussels, for the
    // whole week (ADR-0006 §2).
    const tick = async (at: string) => {
      await queueDuePlanSteps({ db, clock: settableClock(Temporal.Instant.from(at)), queue });
      const jobs = await queue.fetch<{ household: string; week: string }>('plan-draft', {
        batchSize: 100,
      });
      return jobs.filter((job) => job.data.household === h.householdId).map((job) => job.data.week);
    };
    expect(await tick('2026-10-09T21:59:00Z')).toEqual([]);
    expect(await tick('2026-10-09T22:00:00Z')).toEqual([nextWeek]);
    const scheduler = {
      ...h.scheduler,
      clock: settableClock(Temporal.Instant.from('2026-10-09T22:00:00Z')),
    };
    expect(await draftPlan(scheduler, { week: nextWeek })).toMatchObject({
      ok: true,
      planned: true,
    });
    expect((await rows(h, nextWeek)).filter(([task]) => task === 'Dishes')).toHaveLength(7);
    expect(await h.plan(thisWeek)).toBeUndefined();
  });
});

describe('startHousehold, once and by heads only (ADR-0007 §2, TEST-4)', () => {
  it('refuses a second start, which changes nothing (CODE-19)', async () => {
    const h = await inSetup();
    await started(h, 'now');
    const plan = await h.plan(thisWeek);
    const log = await entries(h);
    h.clock.advance({ hours: 1 });
    for (const when of ['now', 'week start']) {
      expect(await startHousehold(h.head, { when })).toEqual({
        ok: false,
        error: 'already-started',
      });
    }
    expect(await firstPlanWeek(h)).toBe(thisWeek);
    expect(await h.plan(thisWeek)).toEqual(plan);
    expect(await h.plan(nextWeek)).toBeUndefined();
    expect(await entries(h)).toEqual(log);
  });

  it('is for heads with two factors only', async () => {
    const h = await inSetup();
    for (const member of [
      h.adult.member,
      { ...h.head.member, twoFactor: false },
      { ...h.head.member, role: 'child' as const },
      { ...h.head.member, hasAccount: false },
    ]) {
      expect(await startHousehold({ ...h.head, member }, { when: 'now' })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
      expect(await startOptions({ ...h.head, member })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await firstPlanWeek(h)).toBeNull();
    expect(await entries(h)).toEqual([]);
    expect(await h.occurrences()).toEqual([]);
  });

  it('refuses anything but now or the week start day (CODE-12)', async () => {
    const h = await inSetup();
    for (const input of [{ when: 'later' }, { when: 'Now' }, {}, null, 'now']) {
      expect(await startHousehold(h.head, input)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await firstPlanWeek(h)).toBeNull();
  });

  it('starts its own household only', async () => {
    const ash = await inSetup();
    const birch = await inSetup();
    await started(ash, 'now');
    expect(await firstPlanWeek(birch)).toBeNull();
    expect(await entries(birch)).toEqual([]);
    expect(await birch.plan(thisWeek)).toBeUndefined();
  });
});

describe('the start entry of the activity log (ADR-0007 §2, ADR-0018 §5, clarifications)', () => {
  it('lists exactly whose shares and which profiles’ days away were set, never a value', async () => {
    const h = await inSetup();
    const sam = await profile(h, 'Sam');
    const kim = await profile(h, 'Kim');
    await profile(h, 'Lee');
    // Robin's own share is listed too (ADR-0018 §4, clarification); Alex's days away are their own
    // to set (ADR-0018 §4).
    await h.share(h.robin, 80);
    await h.share(h.alex, 60);
    await h.temporaryShare(sam, '2026-10-12', '2026-10-18', 50);
    await h.absent(sam, '2026-10-20', '2026-10-21');
    await h.absent(kim, '2026-10-15', '2026-10-15');
    await h.absent(h.alex, '2026-10-22', '2026-10-23');
    await started(h, 'week start');
    expect(await entries(h)).toEqual([
      {
        actorId: h.robin,
        action: 'household.started',
        setBeforeStart: {
          shares: [h.robin, h.alex, sam].sort(),
          daysAway: [kim, sam].sort(),
        },
      },
    ]);
    // Every member sees it, by name (ADR-0018 §5).
    const shown = await householdActivity(h.adult);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.entries.map(({ at, ...entry }) => ({ ...entry, at: at.toString() }))).toEqual([
      {
        id: expect.any(String) as string,
        at: '2026-10-08T08:00:00Z',
        actor: 'Robin',
        action: 'household.started',
        subject: null,
        setBeforeStart: { shares: ['Alex', 'Robin', 'Sam'], daysAway: ['Kim', 'Sam'] },
      },
    ]);
  });

  it('lists the starting head’s own share, and nothing when nothing was set', async () => {
    const h = await inSetup();
    await h.share(h.robin, 80);
    await started(h, 'now');
    expect(await entries(h)).toEqual([
      {
        actorId: h.robin,
        action: 'household.started',
        setBeforeStart: { shares: [h.robin], daysAway: [] },
      },
    ]);
    expect(await householdActivity(h.head)).toMatchObject({
      entries: [{ actor: 'Robin', setBeforeStart: { shares: ['Robin'], daysAway: [] } }],
    });
    const birch = await inSetup();
    await started(birch, 'week start');
    expect(await householdActivity(birch.head)).toMatchObject({
      entries: [{ actor: 'Robin', setBeforeStart: { shares: [], daysAway: [] } }],
    });
  });

  it('shows a member whose profile went as a former member (ADR-0012 §6)', async () => {
    const h = await inSetup();
    const sam = await profile(h, 'Sam');
    await h.absent(sam, '2026-10-20', '2026-10-21');
    await h.share(h.alex, 60);
    await started(h, 'week start');
    // Profiles are deleted by a use case not built yet; the owner stands in for it here.
    await owner.delete(members).where(eq(members.id, sam));
    expect(await householdActivity(h.adult)).toMatchObject({
      entries: [{ setBeforeStart: { shares: ['Alex'], daysAway: [null] } }],
    });
  });
});

describe('startOptions (ADR-0007 §2 step 7)', () => {
  it('shows a head in setup this week’s days left, and when next week’s plan comes', async () => {
    const h = await inSetup();
    const result = await startOptions(h.head);
    if (!result.ok) throw new Error(result.error);
    expect(result.timeZone).toBe('Europe/Brussels');
    expect(result.now.today.toString()).toBe('2026-10-08');
    expect(result.now.last.toString()).toBe('2026-10-11');
    expect(result.weekStart.week.toString()).toBe(nextWeek);
    expect(result.weekStart.draftAt.toString()).toBe('2026-10-10T00:00:00+02:00[Europe/Brussels]');
    expect(result.weekStart.publishAt.toString()).toBe(
      '2026-10-11T12:00:00+02:00[Europe/Brussels]',
    );
  });

  it('says the household has started, once it has', async () => {
    const h = await inSetup();
    await started(h, 'now');
    expect(await startOptions(h.head)).toEqual({ ok: false, error: 'already-started' });
  });
});

describe('viewHousehold, before and after the start (ADR-0007 §2)', () => {
  it('lets heads start it while it is in setup, and nobody once it started', async () => {
    const h = await inSetup();
    expect(await viewHousehold(h.head)).toMatchObject({ mayStart: true, firstPlan: null });
    expect(await viewHousehold(h.adult)).toMatchObject({ mayStart: false, firstPlan: null });
    await started(h, 'now');
    expect(await viewHousehold(h.head)).toMatchObject({ mayStart: false, firstPlan: null });
  });

  it('says when the first plan comes, until its week begins', async () => {
    const h = await inSetup();
    await started(h, 'week start');
    const result = await viewHousehold(h.adult);
    if (!result.ok) throw new Error(result.error);
    expect(result.mayStart).toBe(false);
    expect(result.firstPlan?.week.toString()).toBe(nextWeek);
    expect(result.firstPlan?.draftAt.toString()).toBe('2026-10-10T00:00:00+02:00[Europe/Brussels]');
    expect(result.firstPlan?.publishAt.toString()).toBe(
      '2026-10-11T12:00:00+02:00[Europe/Brussels]',
    );
    h.clock.advance({ hours: 4 * 24 });
    expect(await viewHousehold(h.adult)).toMatchObject({ firstPlan: null });
  });
});
