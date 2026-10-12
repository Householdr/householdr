import {
  accounts,
  activityLog,
  assignments,
  completionCredits,
  completions,
  members,
  occurrences,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { householdActivity } from '../households/activity';
import { membership, type HouseholdContext } from '../households/membership';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { viewPlan } from '../plans/view-plan';
import { completeOccurrence } from './complete-occurrence';
import { undoCompletion } from './undo-completion';

// Completing the occurrences of this week's published plan, and undoing it (ADR-0006 §4), with
// who did it at their own cost (ADR-0002 §1, §4), the activity log's "to whom" (ADR-0018 §5) and
// exact times for those credited only (ADR-0018 §3), on a real database (TEST-11). Invented data
// (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first, and the next.
const week1 = '2026-10-12';
const week2 = '2026-10-19';

/**
 * Ash Lane with Robin, its head, Alex, an adult with an account, Kim, a profile without one, and
 * Sam, an adult with an account; dishes every day and vacuuming on Wednesday. The plan of the week
 * of 12 October is published unless said otherwise, and the clock reads Wednesday 14 October,
 * 10:00 in Brussels.
 */
const household = async ({ publish = true } = {}) => {
  const h = await plannedHousehold(db);
  const [kim] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({ householdId: h.householdId, name: 'Kim', role: 'adult' })
      .returning({ id: members.id }),
  );
  const [account] = await db
    .insert(accounts)
    .values({ name: 'sam', email: `sam-${crypto.randomUUID()}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!kim || !account) throw new Error('No Kim or Sam');
  await h.inIt((tx) =>
    tx
      .insert(members)
      .values({ householdId: h.householdId, name: 'Sam', role: 'adult', accountId: account.id }),
  );
  const sam = await membership({ db }, account.id, h.householdId);
  if (!sam) throw new Error('Sam is not a member');
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  await h.task('Vacuum', 30, 'weekly', '2026-10-14');
  const drafted = await draftPlan(h.scheduler, { week: week1 });
  if (!drafted.ok) throw new Error(`Not drafted: ${drafted.error}`);
  if (publish) await publishPlan(h.scheduler, { week: week1 });
  h.clock.advance({ hours: 6 * 24 });
  const other: HouseholdContext = { ...h.adult, member: sam };
  return { ...h, kim: kim.id, sam: other, samId: sam.id };
};

type Household = Awaited<ReturnType<typeof household>>;

/** The id of an open occurrence of week 1 given to `name`, the first by date and task. */
const occurrenceOf = async (h: PlannedHousehold, name: string, week = week1) => {
  const plan = await h.plan(week);
  const row = plan?.rows.find((r) => r.member === name && r.status === 'open');
  if (!row) throw new Error(`Nothing open for ${name}`);
  return row.occurrence;
};

/** What a household's completions and their credits say, as stored. */
const stored = (h: Household) =>
  h.inIt(async (tx) => ({
    completions: await tx
      .select({
        occurrence: completions.occurrenceId,
        loggedBy: completions.loggedBy,
        at: completions.at,
      })
      .from(completions),
    credits: await tx
      .select({ member: completionCredits.memberId, points: completionCredits.points })
      .from(completionCredits)
      .orderBy(completionCredits.points, completionCredits.memberId),
  }));

/** The status of occurrence `id`. */
const statusOf = async (h: Household, id: string) => {
  const [row] = await h.inIt((tx) =>
    tx.select({ status: occurrences.status }).from(occurrences).where(eq(occurrences.id, id)),
  );
  return row?.status;
};

/** The household's activity log about completions: who did what to whom, oldest first. */
const logged = async (h: Household) => {
  const rows = await h.inIt((tx) =>
    tx
      .select({
        actor: activityLog.actorId,
        action: activityLog.action,
        subject: activityLog.subjectId,
      })
      .from(activityLog)
      // Logged before undone, when at the same moment.
      .orderBy(activityLog.at, activityLog.action),
  );
  return rows.filter((row) => row.action.startsWith('completion.'));
};

/** Completes `occurrence` as `context`, for `doers` if given, and returns the completion's id. */
const completed = async (context: HouseholdContext, occurrence: string, doers?: string[]) => {
  const result = await completeOccurrence(context, { occurrence, doers });
  if (!result.ok) throw new Error(`Not completed: ${result.error}`);
  return result.completionId;
};

describe('completeOccurrence (ADR-0006 §4)', () => {
  it('lets the assignee complete their own with one tap, credited at their own cost', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    expect(await completeOccurrence(h.adult, { occurrence })).toEqual({
      ok: true,
      completionId: expect.any(String) as string,
    });
    expect(await statusOf(h, occurrence)).toBe('done');
    const plan = await h.plan(week1);
    const minutes = plan?.rows.find((row) => row.occurrence === occurrence)?.cost;
    expect(await stored(h)).toEqual({
      completions: [{ occurrence, loggedBy: h.alex, at: new Date('2026-10-14T08:00:00Z') }],
      // Every burden is 1.0 until the comparison game (ADR-0003 §2): the task's minutes.
      credits: [{ member: h.alex, points: minutes }],
    });
    // Done by whoever logged it: nobody else is affected, so nothing is logged (ADR-0018 §5).
    expect(await logged(h)).toEqual([]);
  });

  it('lets any member with an account log it for a profile without one, and logs that', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Kim');
    await completed(h.head, occurrence, [h.kim]);
    expect(await stored(h)).toMatchObject({
      completions: [{ occurrence, loggedBy: h.robin }],
      credits: [{ member: h.kim }],
    });
    expect(await logged(h)).toEqual([
      { actor: h.robin, action: 'completion.logged', subject: h.kim },
    ]);
  });

  it('credits whoever picks up someone else’s occurrence, not its assignee (ADR-0002 §4)', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Robin');
    await completed(h.adult, occurrence);
    const { credits } = await stored(h);
    expect(credits.map((c) => c.member)).toEqual([h.alex]);
    // It became Alex's work, which Robin sees (ADR-0018 §5, clarification).
    expect(await logged(h)).toEqual([
      { actor: h.alex, action: 'completion.picked-up', subject: h.robin },
    ]);
  });

  it('logs a pick-up for each who did it, also when someone else logs it', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    await completed(h.head, occurrence, [h.kim, h.robin]);
    expect(await logged(h)).toEqual(
      expect.arrayContaining([
        { actor: h.robin, action: 'completion.logged', subject: h.kim },
        { actor: h.kim, action: 'completion.picked-up', subject: h.alex },
        { actor: h.robin, action: 'completion.picked-up', subject: h.alex },
      ]),
    );
    expect(await logged(h)).toHaveLength(3);
  });

  it('logs no pick-up when its assignee is among those who did it, or it has none', async () => {
    const h = await household();
    const alexs = await occurrenceOf(h, 'Alex');
    await completed(h.head, alexs, [h.alex, h.robin]);
    expect(await logged(h)).toEqual([
      { actor: h.robin, action: 'completion.logged', subject: h.alex },
    ]);
    const robins = await occurrenceOf(h, 'Robin');
    // Given to nobody, as when nobody could take it (ADR-0001 §7, clarification).
    await h.inIt((tx) =>
      tx
        .update(assignments)
        .set({ memberId: null, cost: null, reason: null, unassignedCause: 'nobody eligible' })
        .where(eq(assignments.occurrenceId, robins)),
    );
    await completed(h.adult, robins);
    expect(await logged(h)).toHaveLength(1);
  });

  it('credits each who did it together at their own cost, and logs it for the others', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    await completed(h.adult, occurrence, [h.alex, h.robin, h.alex]);
    const { credits } = await stored(h);
    const points = credits[0]?.points;
    expect(points).toBeGreaterThan(0);
    expect(credits).toEqual(
      expect.arrayContaining([
        { member: h.alex, points },
        { member: h.robin, points },
      ]),
    );
    expect(credits).toHaveLength(2);
    expect(await logged(h)).toEqual([
      { actor: h.alex, action: 'completion.logged', subject: h.robin },
    ]);
  });

  it('records one completion of two at once, and tells the other who did it (ADR-0019 §6)', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Robin');
    const [robins, alexs] = await Promise.all([
      completeOccurrence(h.head, { occurrence }),
      completeOccurrence(h.adult, { occurrence }),
    ]);
    expect([robins.ok, alexs.ok].filter(Boolean)).toHaveLength(1);
    const first = robins.ok ? { id: h.robin, name: 'Robin' } : { id: h.alex, name: 'Alex' };
    expect(robins.ok ? alexs : robins).toEqual({
      ok: false,
      error: 'already-done',
      doers: [first],
    });
    expect((await stored(h)).completions).toHaveLength(1);
  });

  it('changes nothing when the same completion is sent again (ADR-0008 §7)', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Robin');
    const id = await completed(h.head, occurrence, [h.robin, h.kim]);
    expect(await completeOccurrence(h.head, { occurrence, doers: [h.kim, h.robin] })).toEqual({
      ok: true,
      completionId: id,
    });
    // Not the same: for other members, or logged by someone else.
    expect(await completeOccurrence(h.head, { occurrence })).toMatchObject({
      error: 'already-done',
      doers: [
        { id: h.kim, name: 'Kim' },
        { id: h.robin, name: 'Robin' },
      ],
    });
    expect(await logged(h)).toHaveLength(1);
  });

  it('is refused on a draft, and on another week’s plan', async () => {
    const draft = await household({ publish: false });
    const occurrence = await occurrenceOf(draft, 'Robin');
    expect(await completeOccurrence(draft.head, { occurrence })).toEqual({
      ok: false,
      error: 'not-this-week',
    });
    expect(await statusOf(draft, occurrence)).toBe('open');

    // Next week's plan, published early: done from once its week begins.
    const h = await household();
    await draftPlan(h.scheduler, { week: week2 });
    await publishPlan(h.scheduler, { week: week2 });
    const next = await occurrenceOf(h, 'Alex', week2);
    expect(await completeOccurrence(h.adult, { occurrence: next })).toEqual({
      ok: false,
      error: 'not-this-week',
    });
    h.clock.advance({ hours: 5 * 24 });
    expect(await completeOccurrence(h.adult, { occurrence: next })).toMatchObject({ ok: true });
  });

  it('is refused on an occurrence closed as missed or away (ADR-0002 §2, ADR-0005 §5)', async () => {
    const h = await household();
    const plan = await h.plan(week1);
    if (!plan) throw new Error('No plan');
    for (const status of ['missed', 'away'] as const) {
      const occurrence = await occurrenceOf(h, 'Alex');
      await h.inIt((tx) =>
        tx
          .update(occurrences)
          .set({ status, closedByPlan: plan.id })
          .where(eq(occurrences.id, occurrence)),
      );
      expect(await completeOccurrence(h.adult, { occurrence })).toEqual({
        ok: false,
        error: 'closed',
      });
    }
    expect((await stored(h)).completions).toEqual([]);
  });

  it('is refused for anyone outside the household, and for its members’ profiles', async () => {
    const h = await household();
    const other = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    // Another household sees neither the occurrence nor its members.
    expect(await completeOccurrence(other.adult, { occurrence })).toEqual({
      ok: false,
      error: 'not-found',
    });
    const theirs = await occurrenceOf(other, 'Alex');
    expect(await completeOccurrence(h.head, { occurrence: theirs, doers: [h.robin] })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await completeOccurrence(h.head, { occurrence, doers: [other.alex] })).toEqual({
      ok: false,
      error: 'not-found',
    });
    // A profile without an account can't act for itself (ADR-0018 §4).
    const profile = { ...h.head, member: { ...h.head.member, hasAccount: false } };
    expect(await completeOccurrence(profile, { occurrence })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect((await stored(h)).completions).toEqual([]);
  });

  it('refuses what isn’t an occurrence or anyone who did it (CODE-12)', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    for (const input of [
      {},
      { occurrence: 'the dishes' },
      { occurrence, doers: [] },
      { occurrence, doers: ['Alex'] },
      { occurrence, doers: h.alex },
    ]) {
      expect(await completeOccurrence(h.adult, input)).toEqual({ ok: false, error: 'invalid' });
    }
  });
});

describe('undoCompletion (ADR-0006 §4, clarification)', () => {
  it('lets whoever logged it undo it, and logs that for whom it credited', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Kim');
    const completion = await completed(h.head, occurrence, [h.kim]);
    expect(await undoCompletion(h.head, { completion })).toEqual({ ok: true });
    expect(await statusOf(h, occurrence)).toBe('open');
    expect(await stored(h)).toEqual({ completions: [], credits: [] });
    expect(await logged(h)).toEqual([
      { actor: h.robin, action: 'completion.logged', subject: h.kim },
      { actor: h.robin, action: 'completion.undone', subject: h.kim },
    ]);
    // Open again, so it can be done again.
    expect(await completeOccurrence(h.adult, { occurrence })).toMatchObject({ ok: true });
  });

  it('lets a member it credits undo it, and logs it for the others it credited', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Robin');
    const completion = await completed(h.head, occurrence, [h.robin, h.alex]);
    expect(await undoCompletion(h.adult, { completion })).toEqual({ ok: true });
    expect(await logged(h)).toEqual([
      { actor: h.robin, action: 'completion.logged', subject: h.alex },
      { actor: h.alex, action: 'completion.undone', subject: h.robin },
    ]);
  });

  it('lets a head undo anyone’s, which is logged, and nobody else (ADR-0018 §5)', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    const completion = await completed(h.adult, occurrence);
    expect(await undoCompletion(h.sam, { completion })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    // A head's powers wait for two factors (ADR-0010 §3).
    const pending = { ...h.head, member: { ...h.head.member, twoFactor: false } };
    expect(await undoCompletion(pending, { completion })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await statusOf(h, occurrence)).toBe('done');
    expect(await undoCompletion(h.head, { completion })).toEqual({ ok: true });
    expect(await logged(h)).toEqual([
      { actor: h.robin, action: 'completion.undone', subject: h.alex },
    ]);
  });

  it('is refused once the plan week is over, even to whoever logged it', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    const completion = await completed(h.adult, occurrence);
    // Sunday 18 October, 23:59 in Brussels: still the week.
    h.clock.advance({ hours: 4 * 24 + 13, minutes: 59 });
    expect(await undoCompletion(h.adult, { completion })).toEqual({ ok: true });
    const again = await completed(h.adult, occurrence);
    // Monday 19 October, 00:00 in Brussels: the next week.
    h.clock.advance({ minutes: 1 });
    expect(await undoCompletion(h.adult, { completion: again })).toEqual({
      ok: false,
      error: 'week-over',
    });
    expect(await undoCompletion(h.head, { completion: again })).toEqual({
      ok: false,
      error: 'week-over',
    });
    expect(await undoCompletion(h.sam, { completion: again })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await statusOf(h, occurrence)).toBe('done');
  });

  it('finds nothing undone already, in another household, or not a completion', async () => {
    const h = await household();
    const other = await household();
    const completion = await completed(h.adult, await occurrenceOf(h, 'Alex'));
    expect(await undoCompletion(other.head, { completion })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await undoCompletion(h.adult, { completion })).toEqual({ ok: true });
    expect(await undoCompletion(h.adult, { completion })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await undoCompletion(h.adult, { completion: 'the dishes' })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});

describe('viewPlan, with completions (ADR-0006 §4, ADR-0018 §3)', () => {
  /** The item of `occurrence` in this week's plan, as `context` sees it. */
  const itemOf = async (context: HouseholdContext, occurrence: string) => {
    const result = await viewPlan(context);
    if (!result.ok) throw new Error('Not allowed');
    const items = [
      ...(result.thisWeek?.members.flatMap((m) => m.assignments) ?? []),
      ...(result.thisWeek?.unassigned ?? []),
    ];
    return items.find((item) => item.occurrence === occurrence);
  };

  it('shows the day to everyone, and the exact time to those it credits only', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Robin');
    const completion = await completed(h.head, occurrence, [h.robin, h.kim]);
    const at = Temporal.ZonedDateTime.from('2026-10-14T10:00:00+02:00[Europe/Brussels]');
    const day = Temporal.PlainDate.from('2026-10-14');
    const shown = {
      id: completion,
      day,
      doers: [
        { id: h.kim, name: 'Kim' },
        { id: h.robin, name: 'Robin' },
      ],
      loggedBy: { id: h.robin, name: 'Robin' },
    };
    expect(await itemOf(h.head, occurrence)).toMatchObject({
      completable: false,
      completion: { ...shown, at, mayUndo: true },
    });
    // Another member sees the day only, never when (ADR-0018 §3, ADR-0012 §3).
    expect(await itemOf(h.adult, occurrence)).toMatchObject({
      completable: false,
      completion: { ...shown, at: null, mayUndo: false },
    });
  });

  it('offers to complete what is open in this week’s published plan only', async () => {
    const h = await household();
    const open = await occurrenceOf(h, 'Alex');
    expect(await itemOf(h.adult, open)).toMatchObject({ completable: true, completion: null });
    expect(await itemOf(h.sam, open)).toMatchObject({ completable: true });
    const draft = await household({ publish: false });
    expect(await itemOf(draft.head, await occurrenceOf(draft, 'Alex'))).toMatchObject({
      completable: false,
    });
  });

  it('lets whoever may undo it do so within its week only', async () => {
    const h = await household();
    const occurrence = await occurrenceOf(h, 'Alex');
    await completed(h.adult, occurrence);
    expect(await itemOf(h.adult, occurrence)).toMatchObject({ completion: { mayUndo: true } });
    expect(await itemOf(h.head, occurrence)).toMatchObject({ completion: { mayUndo: true } });
    expect(await itemOf(h.sam, occurrence)).toMatchObject({ completion: { mayUndo: false } });
  });
});

describe('householdActivity, with completions (ADR-0018 §5)', () => {
  it('names whom a completion was logged or undone for, never a value', async () => {
    const h = await household();
    const completion = await completed(h.head, await occurrenceOf(h, 'Kim'), [h.kim]);
    h.clock.advance({ minutes: 5 });
    await undoCompletion(h.head, { completion });
    const activity = await householdActivity(h.adult);
    if (!activity.ok) throw new Error('Not allowed');
    expect(activity.entries.filter((e) => e.action.startsWith('completion.'))).toEqual([
      expect.objectContaining({ actor: 'Robin', action: 'completion.undone', subject: 'Kim' }),
      expect.objectContaining({ actor: 'Robin', action: 'completion.logged', subject: 'Kim' }),
    ]);
  });
});
