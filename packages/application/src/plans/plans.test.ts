import type { Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from './draft-plan';
import { publishPlan } from './publish-plan';
import { plannedHousehold, type PlannedHousehold } from './testing';
import { viewPlan } from './view-plan';

// Drafting and publishing each week's plan (ADR-0006 §1–§2) from the household's tasks, members,
// shares and availability (ADR-0001 §4–§7, ADR-0005), on a real database (TEST-11). The domain
// tests the allocation itself; these test the wiring.

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

const household = (options?: Parameters<typeof plannedHousehold>[1]) =>
  plannedHousehold(db, options);

// The week of Monday 12 October 2026, and the next.
const week1 = '2026-10-12';
const week2 = '2026-10-19';

/** Dishes every day, vacuuming on Wednesdays and the bathroom on Fridays: 215 minutes a week. */
const chores = async (h: PlannedHousehold) => ({
  dishes: await h.task('Dishes', 20, 'daily', '2026-10-08'),
  vacuum: await h.task('Vacuum', 30, 'weekly', '2026-10-14'),
  bathroom: await h.task('Bathroom', 45, 'weekly', '2026-10-16'),
});

const drafted = async (context: Parameters<typeof draftPlan>[0], week = week1) => {
  const result = await draftPlan(context, { week });
  if (!result.ok || !result.planned) throw new Error(`Not drafted: ${JSON.stringify(result)}`);
  return result.planId;
};

/** The points each member got in the plan of `week`. */
const loads = async (h: PlannedHousehold, week = week1) => {
  const plan = await h.plan(week);
  const points: Record<string, number> = { Robin: 0, Alex: 0 };
  for (const row of plan?.rows ?? []) {
    if (row.member) points[row.member] = (points[row.member] ?? 0) + (row.cost ?? 0);
  }
  return points;
};

describe('draftPlan (ADR-0001 §7, ADR-0006 §2)', () => {
  it('gives every occurrence of the week to someone, at its minutes, in fair portions', async () => {
    const h = await household();
    await chores(h);
    const planId = await drafted(h.scheduler);
    const plan = await h.plan(week1);
    expect(plan).toMatchObject({
      id: planId,
      weekEnd: '2026-10-19',
      status: 'draft',
      publishedAt: null,
      version: 1,
    });
    expect(plan?.rows).toHaveLength(9);
    for (const row of plan?.rows ?? []) {
      expect(row.member).not.toBeNull();
      // Every burden is 1.0 until the comparison game brings evidence (ADR-0003 §2).
      expect(row.cost).toBe({ Dishes: 20, Vacuum: 30, Bathroom: 45 }[row.task]);
      expect(row.reason).toBe('lowest relative load');
      expect(row.status).toBe('open');
    }
    expect(plan?.rows.filter((row) => row.task === 'Dishes').map((row) => row.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    // Two full shares: about half each, within the largest task.
    const { Robin = 0, Alex = 0 } = await loads(h);
    expect(Robin + Alex).toBe(215);
    expect(Math.abs(Robin - Alex)).toBeLessThanOrEqual(45);
  });

  it('gives nothing to a member whose share is 0 (ADR-0001 §7, clarification)', async () => {
    const h = await household();
    await chores(h);
    await h.share(h.alex, 0);
    await drafted(h.scheduler);
    const plan = await h.plan(week1);
    expect(new Set(plan?.rows.map((row) => row.member))).toEqual(new Set(['Robin']));
    expect(new Set(plan?.rows.map((row) => row.reason))).toEqual(new Set(['only eligible member']));
  });

  it('gives less to a member with a lower temporary share that week (ADR-0001 §4)', async () => {
    const h = await household();
    await chores(h);
    await h.temporaryShare(h.alex, '2026-10-01', '2026-10-31', 50);
    await drafted(h.scheduler);
    const { Robin = 0, Alex = 0 } = await loads(h);
    // A third for Alex, about.
    expect(Alex).toBeGreaterThan(0);
    expect(Math.abs(Alex - 215 / 3)).toBeLessThanOrEqual(45);
    expect(Robin).toBeGreaterThan(Alex);
  });

  it('gives nothing to a member absent all week, and less to one absent part of it (ADR-0005 §2)', async () => {
    const away = await household();
    await chores(away);
    await away.absent(away.alex, '2026-10-12', '2026-10-18');
    await drafted(away.scheduler);
    expect(await loads(away)).toEqual({ Robin: 215, Alex: 0 });

    const partly = await household();
    await chores(partly);
    // Home three days of seven: three tenths of the work, about.
    await partly.absent(partly.alex, '2026-10-12', '2026-10-15');
    await drafted(partly.scheduler);
    const { Robin = 0, Alex = 0 } = await loads(partly);
    expect(Alex).toBeGreaterThan(0);
    expect(Math.abs(Alex - (215 * 3) / 10)).toBeLessThanOrEqual(45);
    expect(Robin).toBeGreaterThan(Alex);
  });

  it('plans no week the household is away for entirely (ADR-0005 §5)', async () => {
    const h = await household();
    await chores(h);
    await h.away('2026-10-10', '2026-10-20');
    expect(await draftPlan(h.scheduler, { week: week1 })).toEqual({ ok: true, planned: false });
    expect(await h.plan(week1)).toBeUndefined();
    expect(await h.occurrences()).toEqual([]);
  });

  it('counts a week partly away over its days at home only (ADR-0005 §5)', async () => {
    // Away Monday to Wednesday; Alex is away Thursday to Sunday, so never home this week.
    const absent = await household();
    await chores(absent);
    await absent.away('2026-10-12', '2026-10-14');
    await absent.absent(absent.alex, '2026-10-15', '2026-10-18');
    await drafted(absent.scheduler);
    expect(await loads(absent)).toEqual({ Robin: 215, Alex: 0 });

    // Alex's share is 0 on the days at home, whatever it is on the days away.
    const resting = await household();
    await chores(resting);
    await resting.away('2026-10-12', '2026-10-14');
    await resting.temporaryShare(resting.alex, '2026-10-15', '2026-10-18', 0);
    await drafted(resting.scheduler);
    expect(await loads(resting)).toEqual({ Robin: 215, Alex: 0 });
  });

  it('gives what nobody can take to nobody, with the cause, for the heads (ADR-0001 §7)', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.share(h.alex, 0);
    await h.absent(h.robin, '2026-10-12', '2026-10-18');
    await drafted(h.scheduler);
    expect((await h.plan(week1))?.rows).toEqual([
      expect.objectContaining({
        task: 'Vacuum',
        member: null,
        cost: null,
        reason: null,
        cause: 'nobody eligible',
      }),
    ]);
  });

  it('never drafts for a household in setup, or a week before its first (ADR-0007 §2)', async () => {
    const inSetup = await household({ started: null });
    await chores(inSetup);
    expect(await draftPlan(inSetup.scheduler, { week: week1 })).toEqual({
      ok: false,
      error: 'not-started',
    });
    expect(await draftPlan(inSetup.head, { week: week1 })).toEqual({
      ok: false,
      error: 'not-started',
    });
    const later = await household({ started: week2 });
    await chores(later);
    expect(await draftPlan(later.scheduler, { week: week1 })).toEqual({
      ok: false,
      error: 'not-started',
    });
    expect(await inSetup.plan(week1)).toBeUndefined();
    expect(await later.plan(week1)).toBeUndefined();
  });

  it('drafts a week once as the scheduler: running twice changes nothing (CODE-19)', async () => {
    const h = await household();
    await chores(h);
    const planId = await drafted(h.scheduler);
    const before = await h.plan(week1);
    h.clock.advance({ minutes: 1 });
    await h.task('Windows', 15, 'weekly', '2026-10-13');
    expect(await draftPlan(h.scheduler, { week: '2026-10-15' })).toEqual({
      ok: true,
      planned: true,
      planId,
    });
    expect(await h.plan(week1)).toEqual(before);
  });

  it('replaces the draft when a head drafts it again, keeping each occurrence (ADR-0006 §2)', async () => {
    const h = await household();
    await chores(h);
    const planId = await drafted(h.scheduler);
    const before = await h.plan(week1);
    h.clock.advance({ hours: 1 });
    await h.task('Windows', 15, 'weekly', '2026-10-13');
    expect(await drafted(h.head)).toBe(planId);
    const after = await h.plan(week1);
    expect(after).toMatchObject({ version: 2, status: 'draft' });
    expect(after?.draftedAt).toEqual(new Date('2026-10-08T09:00:00Z'));
    expect(after?.rows).toHaveLength(10);
    expect(after?.rows.map((row) => row.task)).toContain('Windows');
    // The same occurrences, kept across drafts: the domain knows them as task@date.
    const dishesIn = (plan: typeof before) =>
      plan?.rows.filter((row) => row.task === 'Dishes').map((row) => row.occurrence);
    expect(dishesIn(after)).toEqual(dishesIn(before));
    expect((await h.occurrences()).filter((o) => o.task === 'Dishes')).toHaveLength(7);
  });

  it('removes a draft drafted again once the household is away all week', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    await h.away('2026-10-12', '2026-10-18');
    expect(await draftPlan(h.head, { week: week1 })).toEqual({ ok: true, planned: false });
    expect(await h.plan(week1)).toBeUndefined();
    expect(await h.occurrences()).toEqual([]);
  });

  it('never changes a published plan, which is frozen (ADR-0006 §3)', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    expect(await publishPlan(h.scheduler, { week: week1 })).toEqual({ ok: true });
    const published = await h.plan(week1);
    await h.task('Windows', 15, 'weekly', '2026-10-13');
    for (const context of [h.head, h.scheduler]) {
      expect(await draftPlan(context, { week: week1 })).toEqual({
        ok: false,
        error: 'published',
      });
    }
    expect(await h.plan(week1)).toEqual(published);
  });

  it('is for heads with two factors and the scheduler only (ADR-0006 §2, TEST-4)', async () => {
    const h = await household();
    await chores(h);
    for (const member of [
      h.adult.member,
      { ...h.head.member, twoFactor: false },
      { ...h.head.member, role: 'child' as const },
      { ...h.head.member, hasAccount: false },
    ]) {
      expect(await draftPlan({ ...h.head, member }, { week: week1 })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await h.plan(week1)).toBeUndefined();
  });

  it('refuses a week that isn’t a day (CODE-12)', async () => {
    const h = await household();
    for (const week of ['next week', '2026-02-30', 20261012, undefined]) {
      expect(await draftPlan(h.head, { week })).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('drafts within its own household only (TEST-4)', async () => {
    const ash = await household();
    const birch = await household();
    await chores(ash);
    await chores(birch);
    await drafted(ash.scheduler);
    expect(await birch.plan(week1)).toBeUndefined();
    expect(await birch.occurrences()).toEqual([]);
  });
});

describe('the weeks after (ADR-0002 §2, ADR-0004 §4)', () => {
  /** Week 1 drafted and published, then the clock on Saturday of week 1 and week 2 drafted. */
  const twoWeeks = async (h: PlannedHousehold) => {
    await drafted(h.scheduler, week1);
    await publishPlan(h.scheduler, { week: week1 });
    h.clock.advance({ hours: 9 * 24 });
    return drafted(h.scheduler, week2);
  };

  it('rolls an open occurrence over into the next week, or marks it to close if a new one replaces it', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.task('Windows', 15, 'biweekly', '2026-10-14');
    const week2Plan = await twoWeeks(h);
    const rows = (await h.plan(week2))?.rows;
    expect(rows?.map((row) => [row.task, row.date])).toEqual([
      // Not done in week 1, and no new one in week 2: it rolls over.
      ['Windows', '2026-10-14'],
      ['Vacuum', '2026-10-21'],
    ]);
    const week1Windows = (await h.plan(week1))?.rows.find((row) => row.task === 'Windows');
    expect(rows?.[0]?.occurrence).toBe(week1Windows?.occurrence);
    // Still week 1's work until week 2 begins, which closes it if nobody did it (`closing.test.ts`).
    expect(await h.occurrences()).toEqual([
      expect.objectContaining({
        task: 'Vacuum',
        date: '2026-10-14',
        status: 'open',
        closedByPlan: week2Plan,
      }),
      expect.objectContaining({
        task: 'Windows',
        date: '2026-10-14',
        status: 'open',
        closedByPlan: null,
      }),
      expect.objectContaining({ task: 'Vacuum', date: '2026-10-21', status: 'open' }),
    ]);
  });

  it('marks a lapsing occurrence whose window ends with its week to close as the next begins', async () => {
    const h = await household();
    await h.task('Bins', 5, 'weekly', '2026-10-14', 'lapse');
    await h.task('Plants', 10, 'biweekly', '2026-10-14', 'lapse');
    const week2Plan = await twoWeeks(h);
    expect((await h.plan(week2))?.rows.map((row) => [row.task, row.date])).toEqual([
      ['Bins', '2026-10-21'],
    ]);
    const marked = { status: 'open', closedByPlan: week2Plan };
    expect(await h.occurrences()).toEqual([
      expect.objectContaining({ task: 'Bins', date: '2026-10-14', ...marked }),
      expect.objectContaining({ task: 'Plants', date: '2026-10-14', ...marked }),
      expect.objectContaining({ task: 'Bins', date: '2026-10-21', status: 'open' }),
    ]);
  });

  it('marks the same occurrences when a head drafts the next week again', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.task('Windows', 15, 'biweekly', '2026-10-14');
    await h.task('Plants', 10, 'biweekly', '2026-10-14', 'lapse');
    await twoWeeks(h);
    const once = await h.occurrences();
    const plan = await h.plan(week2);
    await drafted(h.head, week2);
    expect(await h.occurrences()).toEqual(once);
    expect((await h.plan(week2))?.rows.map((row) => row.occurrence)).toEqual(
      plan?.rows.map((row) => row.occurrence),
    );
  });

  it('rotates a task away from whoever had it last week (ADR-0001 §7, clarification)', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.task('Mop', 30, 'weekly', '2026-10-14');
    await twoWeeks(h);
    const whoHad = async (week: string) =>
      Object.fromEntries((await h.plan(week))?.rows.map((row) => [row.task, row.member]) ?? []);
    const first = await whoHad(week1);
    expect(new Set(Object.values(first))).toEqual(new Set(['Robin', 'Alex']));
    expect(await whoHad(week2)).toEqual({ Vacuum: first.Mop, Mop: first.Vacuum });
  });

  it('places a floating occurrence once, and carries it on as the same occurrence', async () => {
    const h = await household();
    // Monthly from 8 October: it floats over the weeks up to the one of 8 November.
    await h.task('Fridge', 60, 'monthly', '2026-10-08');
    await twoWeeks(h);
    const fridge = (week: string) => h.plan(week).then((plan) => plan?.rows);
    const [first] = (await fridge(week1)) ?? [];
    expect(first).toMatchObject({ task: 'Fridge', date: '2026-10-08' });
    expect(await fridge(week2)).toEqual([
      expect.objectContaining({ occurrence: first?.occurrence, date: '2026-10-08' }),
    ]);
    expect(await h.occurrences()).toHaveLength(1);
  });
});

describe('publishPlan (ADR-0006 §2)', () => {
  it('publishes the draft, recording when, once (CODE-19)', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    h.clock.advance({ hours: 2 });
    expect(await publishPlan(h.scheduler, { week: week1 })).toEqual({ ok: true });
    const plan = await h.plan(week1);
    expect(plan).toMatchObject({ status: 'published', version: 2 });
    expect(plan?.publishedAt).toEqual(new Date('2026-10-08T10:00:00Z'));
    h.clock.advance({ hours: 2 });
    expect(await publishPlan(h.scheduler, { week: week1 })).toEqual({ ok: true });
    expect(await h.plan(week1)).toEqual(plan);
  });

  it('lets a head publish early the draft they saw (ADR-0006 §2, ADR-0019 §5)', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    await drafted(h.head);
    expect(await publishPlan(h.head, { week: week1, version: 1 })).toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await publishPlan(h.head, { week: week1 })).toEqual({ ok: false, error: 'invalid' });
    expect((await h.plan(week1))?.status).toBe('draft');
    expect(await publishPlan(h.head, { week: '2026-10-16', version: 2 })).toEqual({ ok: true });
    expect((await h.plan(week1))?.status).toBe('published');
  });

  it('finds nothing to publish for a week without a draft', async () => {
    const h = await household();
    expect(await publishPlan(h.scheduler, { week: week1 })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('is for heads with two factors and the scheduler only (TEST-4)', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    for (const member of [h.adult.member, { ...h.head.member, twoFactor: false }]) {
      expect(await publishPlan({ ...h.head, member }, { week: week1, version: 1 })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect((await h.plan(week1))?.status).toBe('draft');
  });
});

describe('viewPlan (ADR-0006 §2, ADR-0007 §5)', () => {
  it('shows heads the draft, with what nobody can take and when it is published', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.task('Windows', 15, 'weekly', '2026-10-13');
    await drafted(h.scheduler);
    // Sunday 11 October 12:00 in Brussels.
    const result = await viewPlan(h.head);
    if (!result.ok) throw new Error('Not shown');
    expect(result).toMatchObject({
      ok: true,
      household: 'Ash Lane',
      timeZone: 'Europe/Brussels',
      thisWeek: null,
      mayPublish: true,
    });
    const plan = result.nextWeek;
    expect(plan).toMatchObject({ status: 'draft', version: 1, unassigned: [] });
    expect(plan?.start.toString()).toBe(week1);
    expect(plan?.end.toString()).toBe(week2);
    expect(plan?.publishAt?.toString()).toBe('2026-10-11T12:00:00+02:00[Europe/Brussels]');
    expect(plan?.members.map((m) => m.name)).toEqual(['Robin', 'Alex']);
    const all = plan?.members.flatMap((m) => m.assignments) ?? [];
    expect(all.map((a) => [a.task, a.date.toString()]).sort()).toEqual([
      ['Vacuum', '2026-10-14'],
      ['Windows', '2026-10-13'],
    ]);
    for (const a of all) {
      expect(a.window.start.toString()).toBe('2026-10-12T00:00:00+02:00[Europe/Brussels]');
      expect(a.window.end.toString()).toBe('2026-10-19T00:00:00+02:00[Europe/Brussels]');
      expect(a.reason).toBe('lowest relative load');
    }
  });

  it('shows other members no draft, but the published plan (ADR-0006 §2, clarification)', async () => {
    const h = await household();
    await chores(h);
    await drafted(h.scheduler);
    expect(await viewPlan(h.adult)).toMatchObject({
      ok: true,
      thisWeek: null,
      nextWeek: null,
      mayPublish: false,
    });
    await publishPlan(h.scheduler, { week: week1 });
    const result = await viewPlan(h.adult);
    if (!result.ok) throw new Error('Not shown');
    expect(result.nextWeek).toMatchObject({ status: 'published', publishAt: null, unassigned: [] });
    // Their own points, and nobody else's: another's would tell how hard they find a task
    // (ADR-0003 §5).
    const [robin, alex] = result.nextWeek?.members ?? [];
    expect(robin?.assignments.length).toBeGreaterThan(0);
    expect(alex?.assignments.length).toBeGreaterThan(0);
    for (const a of robin?.assignments ?? []) expect(a.cost).toBeNull();
    for (const a of alex?.assignments ?? []) expect(a.cost).toBeGreaterThan(0);
  });

  it('shows this week’s plan once it has begun, and what nobody could take to heads only', async () => {
    const h = await household();
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await h.share(h.alex, 0);
    await h.absent(h.robin, '2026-10-12', '2026-10-18');
    await drafted(h.scheduler);
    await publishPlan(h.scheduler, { week: week1 });
    h.clock.advance({ hours: 5 * 24 });
    const forHead = await viewPlan(h.head);
    expect(forHead).toMatchObject({ ok: true, nextWeek: null });
    if (!forHead.ok) throw new Error('Not shown');
    expect(forHead.thisWeek?.unassigned).toEqual([
      expect.objectContaining({ task: 'Vacuum', cause: 'nobody eligible' }),
    ]);
    const forAdult = await viewPlan(h.adult);
    if (!forAdult.ok) throw new Error('Not shown');
    expect(forAdult.thisWeek).toMatchObject({ status: 'published', unassigned: [] });
  });

  it('is refused to a profile without an account (ADR-0018 §4)', async () => {
    const h = await household();
    expect(
      await viewPlan({ ...h.adult, member: { ...h.adult.member, hasAccount: false } }),
    ).toEqual({ ok: false, error: 'not-allowed' });
  });

  it('shows nothing of another household’s plans (TEST-4)', async () => {
    const ash = await household();
    const birch = await household();
    await chores(ash);
    await drafted(ash.scheduler);
    await publishPlan(ash.scheduler, { week: week1 });
    expect(await viewPlan(birch.head)).toMatchObject({
      ok: true,
      thisWeek: null,
      nextWeek: null,
      mayPublish: true,
    });
  });
});
