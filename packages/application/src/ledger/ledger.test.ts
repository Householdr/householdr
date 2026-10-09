import { households, ledgerEntries, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import type { HouseholdContext } from '../households/context';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { householdBalances } from './balances';
import { settlePlanWeek } from './settle-plan-week';

// Settling each plan week into the ledger once it is over (ADR-0002 §1, §7), the balances every
// member sees (§6), and drafting catching up on them (§3), on a real database with a clock the tests
// set (TEST-11). Every burden is 1.0 until the comparison game (ADR-0003 §2), so a task costs its
// minutes. Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the households' first, and the next two. The households are
// in Brussels, where week 2 begins at 22:00 UTC on Sunday 18 October.
const week1 = '2026-10-12';
const week2 = '2026-10-19';
const week3 = '2026-10-26';
const wednesday = '2026-10-14T08:00:00Z';
const week2Begins = '2026-10-18T22:00:00Z';

/** Moves the household's clock on to `iso`. */
const at = (h: PlannedHousehold, iso: string) => {
  h.clock.advance(Temporal.Instant.from(iso).since(h.clock.now()));
};

/**
 * Ash Lane, with Robin, its head, and Alex, both with a full share: dishes every day and the bins on
 * Wednesday, 20 minutes each, so 160 points in week 1, whose plan is drafted and published. The
 * clock reads Wednesday 14 October.
 */
const household = async () => {
  const h = await plannedHousehold(db);
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  await h.task('Bins', 20, 'weekly', '2026-10-14');
  await planned(h, week1);
  at(h, wednesday);
  return h;
};

/** Drafts and publishes the plan of `week` as the scheduler. */
const planned = async (h: PlannedHousehold, week: string) => {
  const drafted = await draftPlan(h.scheduler, { week });
  if (!drafted.ok || !drafted.planned) throw new Error(`Not drafted: ${JSON.stringify(drafted)}`);
  await publishPlan(h.scheduler, { week });
};

/** The open occurrences of `week`'s plan given to `name`. */
const openFor = async (h: PlannedHousehold, name: string, week = week1) =>
  ((await h.plan(week))?.rows ?? [])
    .filter((row) => row.member === name && row.status === 'open')
    .map((row) => row.occurrence);

/** Completes `occurrence` as `context`, for `doers` if given. */
const complete = async (context: HouseholdContext, occurrence: string, doers?: string[]) => {
  const result = await completeOccurrence(context, { occurrence, doers });
  if (!result.ok) throw new Error(`Not completed: ${result.error}`);
};

/** Each member does everything the plan of `week1` gave them, but `skips` of their own. */
const everyoneDoesTheirs = async (h: PlannedHousehold, skips: Record<string, number> = {}) => {
  for (const [name, context] of [
    ['Robin', h.head],
    ['Alex', h.adult],
  ] as const) {
    const own = await openFor(h, name);
    for (const occurrence of own.slice(skips[name] ?? 0)) await complete(context, occurrence);
  }
};

/** Settles `week` as the scheduler, once week 2 has begun unless the clock is later. */
const settle = async (h: PlannedHousehold, week = week1) => {
  if (Temporal.Instant.compare(h.clock.now(), Temporal.Instant.from(week2Begins)) < 0) {
    at(h, week2Begins);
  }
  return settlePlanWeek(h.scheduler, { week });
};

/** What settling `week` changed each member's balance by, by name, as stored. */
const changes = async (h: PlannedHousehold, week = week1) => {
  const rows = await h.inIt((tx) =>
    tx
      .select({ name: members.name, change: ledgerEntries.change })
      .from(ledgerEntries)
      .innerJoin(members, eq(members.id, ledgerEntries.memberId))
      .where(eq(ledgerEntries.week, week)),
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.change]));
};

/** The points each member got in the plan of `week`. */
const loads = async (h: PlannedHousehold, week: string) => {
  const points: Record<string, number> = { Robin: 0, Alex: 0 };
  for (const row of (await h.plan(week))?.rows ?? []) {
    if (row.member) points[row.member] = (points[row.member] ?? 0) + (row.cost ?? 0);
  }
  return points;
};

describe('settlePlanWeek (ADR-0002 §1, §7)', () => {
  it('changes every balance by about 0 for a week done as planned', async () => {
    const h = await household();
    expect(await loads(h, week1)).toEqual({ Robin: 80, Alex: 80 });
    await everyoneDoesTheirs(h);
    expect(await settle(h)).toEqual({ ok: true, settled: true });
    const changed = await changes(h);
    expect(Object.keys(changed).sort()).toEqual(['Alex', 'Robin']);
    for (const change of Object.values(changed)) expect(change).toBeCloseTo(0, 9);
  });

  it('puts whoever skips a task in deficit by its cost, and nothing more', async () => {
    const h = await household();
    await everyoneDoesTheirs(h, { Alex: 1 });
    await settle(h);
    const changed = await changes(h);
    expect(changed.Alex).toBeCloseTo(-20, 9);
    expect(changed.Robin).toBeCloseTo(0, 9);
  });

  it('credits whoever picks up someone else’s task, and not its assignee (§4)', async () => {
    const h = await household();
    const [alexs] = await openFor(h, 'Alex');
    if (!alexs) throw new Error('Nothing for Alex');
    await complete(h.head, alexs);
    await everyoneDoesTheirs(h);
    await settle(h);
    const changed = await changes(h);
    expect(changed.Robin).toBeCloseTo(20, 9);
    expect(changed.Alex).toBeCloseTo(-20, 9);
  });

  it('credits each who did a task together at their own cost', async () => {
    const h = await household();
    const [alexs] = await openFor(h, 'Alex');
    if (!alexs) throw new Error('Nothing for Alex');
    await complete(h.adult, alexs, [h.alex, h.robin]);
    await everyoneDoesTheirs(h);
    await settle(h);
    const changed = await changes(h);
    expect(changed.Alex).toBeCloseTo(0, 9);
    expect(changed.Robin).toBeCloseTo(20, 9);
  });

  it('lowers what someone owes for days they turn out to be away, never a deficit', async () => {
    const h = await household();
    // Reported on Wednesday, for Thursday to Sunday: Alex is here 3 of the week's 7 days, so owes
    // 3/10 of its 160 points, and Robin 7/10.
    await h.absent(h.alex, '2026-10-15', '2026-10-18');
    await settle(h);
    const changed = await changes(h);
    expect(changed.Alex).toBeCloseTo(-48, 9);
    expect(changed.Robin).toBeCloseTo(-112, 9);
  });

  it('counts a task carried over but done before the next week began in its own week only', async () => {
    const h = await plannedHousehold(db);
    // Every other Wednesday from 14 October: week 2's draft, on Saturday, carries it over.
    await h.task('Windows', 15, 'biweekly', '2026-10-14');
    await planned(h, week1);
    at(h, '2026-10-17T08:00:00Z');
    await planned(h, week2);
    expect((await h.plan(week2))?.rows).toEqual([
      expect.objectContaining({ task: 'Windows', status: 'open' }),
    ]);
    // Sunday: still week 1, whatever week 2's plan says (ADR-0002 §2, clarification).
    at(h, '2026-10-18T08:00:00Z');
    const [windows] = (await h.plan(week1))?.rows ?? [];
    if (!windows) throw new Error('No windows');
    await complete(h.adult, windows.occurrence);
    await settle(h, week1);
    const first = await changes(h, week1);
    expect(first.Alex).toBeCloseTo(7.5, 9);
    expect(first.Robin).toBeCloseTo(-7.5, 9);
    at(h, '2026-10-25T23:00:00Z');
    expect(await settle(h, week2)).toEqual({ ok: true, settled: true });
    expect(await changes(h, week2)).toEqual({ Robin: 0, Alex: 0 });
  });

  it('changes nothing when it settles a week again (CODE-19)', async () => {
    const h = await household();
    await everyoneDoesTheirs(h, { Robin: 2 });
    await settle(h);
    const once = await h.inIt((tx) => tx.select().from(ledgerEntries));
    expect(once).toHaveLength(2);
    h.clock.advance({ hours: 1 });
    expect(await settle(h)).toEqual({ ok: true, settled: true });
    expect(await h.inIt((tx) => tx.select().from(ledgerEntries))).toEqual(once);
  });

  it('settles nothing for a week without a published plan', async () => {
    const h = await plannedHousehold(db);
    await h.task('Dishes', 20, 'daily', '2026-10-08');
    // Week 1 drafted but never published; week 2 never planned; week 3 away all week.
    await draftPlan(h.scheduler, { week: week1 });
    await h.away(week3, '2026-11-01');
    expect(await draftPlan(h.scheduler, { week: week3 })).toEqual({ ok: true, planned: false });
    at(h, '2026-11-02T08:00:00Z');
    for (const week of [week1, week2, week3]) {
      expect(await settlePlanWeek(h.scheduler, { week })).toEqual({ ok: true, settled: false });
    }
    expect(await h.inIt((tx) => tx.select().from(ledgerEntries))).toEqual([]);
  });

  it('waits until the week is over: the next has begun in the household’s time zone', async () => {
    const h = await household();
    at(h, '2026-10-18T21:59:00Z');
    expect(await settlePlanWeek(h.scheduler, { week: week1 })).toEqual({
      ok: false,
      error: 'not-over',
    });
    expect(await settle(h)).toEqual({ ok: true, settled: true });
  });

  it('settles a week begun before it was planned over the days it was planned for (ADR-0007 §3)', async () => {
    const h = await plannedHousehold(db, { startedNow: true });
    await h.task('Dishes', 20, 'daily', '2026-10-08');
    // Alex was away on Monday and Tuesday, before the household started on Wednesday: those
    // days are gone for everyone, so both owe half of what was planned for the days left.
    await h.absent(h.alex, week1, '2026-10-13');
    at(h, wednesday);
    await planned(h, week1);
    // Dishes from Wednesday to Sunday.
    const load = await loads(h, week1);
    expect((load.Robin ?? 0) + (load.Alex ?? 0)).toBe(100);
    await settle(h);
    const changed = await changes(h);
    expect(changed.Robin).toBeCloseTo(-50, 9);
    expect(changed.Alex).toBeCloseTo(-50, 9);
  });

  it('is the scheduler’s alone, and refuses what isn’t a day (CODE-12)', async () => {
    const h = await household();
    at(h, week2Begins);
    expect(await settlePlanWeek(h.head, { week: week1 })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await settlePlanWeek(h.scheduler, { week: '2026-02-30' })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});

describe('drafting with the balances (ADR-0001 §7, ADR-0002 §3)', () => {
  it('gives more to a member who is behind, at the household’s rebalance rate', async () => {
    const h = await household();
    // Fast: the plan catches up on half of a balance, 40 of Alex's 80 points, two of his tasks.
    await h.inIt((tx) => tx.update(households).set({ rebalance: 'fast' }));
    // Alex did none of his 80 points, Robin all of his.
    await everyoneDoesTheirs(h, { Alex: 4 });
    await settle(h);
    expect(await changes(h)).toMatchObject({ Alex: -80 });
    // Week 3's draft time, Saturday 24 October 00:00 in Brussels, after week 1 was settled.
    at(h, '2026-10-23T22:00:00Z');
    await planned(h, week3);
    const load = await loads(h, week3);
    expect(load.Alex).toBeGreaterThan(load.Robin ?? 0);
    const reasons = (await h.plan(week3))?.rows.filter((row) => row.member === 'Alex');
    expect(reasons).toContainEqual(expect.objectContaining({ reason: 'catching up' }));
  });
});

describe('householdBalances (ADR-0002 §6)', () => {
  /** A settled week 1 in which Alex skipped one task and picked up two of Robin's. */
  const settled = async () => {
    const h = await household();
    const robins = await openFor(h, 'Robin');
    for (const occurrence of robins.slice(0, 2)) await complete(h.adult, occurrence);
    await everyoneDoesTheirs(h, { Alex: 1 });
    await settle(h);
    return h;
  };

  it('shows every member each balance and what each settled week changed it by, and nothing else', async () => {
    const h = await settled();
    // Alex did 3 of his 4 and 2 of Robin's: 100 of the 80 owed; Robin did 2 of his 4: 40.
    const expected = {
      ok: true,
      rebalance: 'normal',
      members: [
        {
          id: h.robin,
          name: 'Robin',
          balance: -40,
          history: [
            {
              start: Temporal.PlainDate.from(week1),
              end: Temporal.PlainDate.from(week2),
              change: -40,
            },
          ],
        },
        {
          id: h.alex,
          name: 'Alex',
          balance: 20,
          history: [
            {
              start: Temporal.PlainDate.from(week1),
              end: Temporal.PlainDate.from(week2),
              change: 20,
            },
          ],
        },
      ],
    };
    // Each member, the head and an adult alike, sees the same (ADR-0012 §3).
    expect(await householdBalances(h.head)).toEqual(expected);
    expect(await householdBalances(h.adult)).toEqual(expected);
    // A child too (ADR-0018 §5).
    const child = { ...h.adult, member: { ...h.adult.member, role: 'child' as const } };
    expect(await householdBalances(child)).toEqual(expected);
  });

  it('never returns what anyone owed or did, which would tell shares and burdens (ADR-0018 §4)', async () => {
    const h = await settled();
    const keys = new Set<string>();
    const collect = (value: unknown) => {
      if (value instanceof Temporal.PlainDate) return;
      if (Array.isArray(value)) for (const item of value) collect(item);
      else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          keys.add(key);
          collect(item);
        }
      }
    };
    collect(await householdBalances(h.adult));
    expect([...keys].sort()).toEqual([
      'balance',
      'change',
      'end',
      'history',
      'id',
      'members',
      'name',
      'ok',
      'rebalance',
      'start',
    ]);
    // Nor does the ledger keep them.
    const [entry] = await h.inIt((tx) => tx.select().from(ledgerEntries).limit(1));
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'at',
      'change',
      'householdId',
      'id',
      'kind',
      'memberId',
      'week',
    ]);
  });

  it('newest week first, with the balance their sum', async () => {
    const h = await household();
    await everyoneDoesTheirs(h, { Alex: 1 });
    await settle(h);
    // Week 2 is drafted late, as the scheduler catches up, so its plan is for the whole week.
    await planned(h, week2);
    at(h, '2026-10-25T23:00:00Z');
    await settle(h, week2);
    const result = await householdBalances(h.adult);
    if (!result.ok) throw new Error('Not shown');
    const alex = result.members.find((m) => m.id === h.alex);
    expect(alex?.history.map((w) => w.start.toString())).toEqual([week2, week1]);
    const sum = alex?.history.reduce((total, w) => total + w.change, 0) ?? Number.NaN;
    expect(alex?.balance).toBeCloseTo(sum, 9);
  });

  it('shows 0 and no history for a household with no week settled yet', async () => {
    const h = await household();
    expect(await householdBalances(h.head)).toMatchObject({
      ok: true,
      members: [
        { name: 'Robin', balance: 0, history: [] },
        { name: 'Alex', balance: 0, history: [] },
      ],
    });
  });

  it('is refused to a profile without an account (ADR-0018 §4)', async () => {
    const h = await household();
    expect(
      await householdBalances({ ...h.adult, member: { ...h.adult.member, hasAccount: false } }),
    ).toEqual({ ok: false, error: 'not-allowed' });
  });

  it('shows nothing of another household’s ledger (TEST-4, ADR-0008 §9)', async () => {
    const ash = await settled();
    const birch = await household();
    const seen = await householdBalances(birch.head);
    expect(seen).toEqual({
      ok: true,
      rebalance: 'normal',
      members: [
        { id: birch.robin, name: 'Robin', balance: 0, history: [] },
        { id: birch.alex, name: 'Alex', balance: 0, history: [] },
      ],
    });
    expect(await birch.inIt((tx) => tx.select().from(ledgerEntries))).toEqual([]);
    expect(await ash.inIt((tx) => tx.select().from(ledgerEntries))).toHaveLength(2);
  });
});
