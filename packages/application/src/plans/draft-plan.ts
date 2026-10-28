import {
  assignments,
  inHousehold,
  nextVersion,
  occurrences,
  plans,
  schedules,
  tasks,
  type Transaction,
} from '@householdr/db';
import {
  allocate,
  goneDays,
  householdDate,
  occurrenceId,
  occurrences as occurrencesOf,
  oneOffOccurrence,
  planWeek,
  rebalanceRates,
  weekOccurrences,
  type AllocationTask,
  type PlannedOccurrence,
  type PlanTask,
  type PlanWeek,
  type Schedule,
  type Window,
} from '@householdr/domain';
import { and, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { closeDue } from './closing';
import { lastDoneOf } from '../tasks/last-done';
import { scheduleOf } from '../tasks/stored-schedule';
import { timingColumns, timingOf } from '../tasks/stored-task';
import { rulesByTask } from '../tasks/task-rules';
import { carriedLinks } from './carried-links';
import { membersOf } from './allocation-members';
import {
  awayIn,
  awaySince,
  mayDraft,
  planningOf,
  weekInput,
  type PlanContext,
  type Planning,
} from './planning';

type DraftPlanResult =
  | { ok: true; planned: true; planId: string }
  /** The household is away the whole week, which gets no plan (ADR-0005 §5). */
  | { ok: true; planned: false }
  /** Only heads draft, once signed in with two factors, besides the scheduler (ADR-0006 §2). */
  | { ok: false; error: 'not-allowed' }
  /** Not a day. */
  | { ok: false; error: 'invalid' }
  /**
   * The household has no plans for that week: it is in setup, or the week comes before its first
   * plan week (ADR-0007 §2).
   */
  | { ok: false; error: 'not-started' }
  /** The week's plan is published, and frozen (ADR-0006 §3). */
  | { ok: false; error: 'published' };

/**
 * Drafts the household's plan for the plan week of `week`, any of its days (ADR-0001 §7, ADR-0006
 * §2): the week's occurrences, with those still open from earlier weeks and the floating ones it
 * places, each given to a member or left unassigned for the heads. Those still open from earlier
 * weeks that it doesn't carry over, by their tasks' on-miss policy, it marks to close as missed when
 * its week begins, not before: until then they are their own week's work (ADR-0002 §2,
 * clarifications). The scheduler drafts a week once; a head drafting it again while it is a draft
 * replaces it. A week the household is away for entirely gets no plan (ADR-0005 §5); one drafted
 * again once it has begun, such as the week a household started in, is planned for the days left
 * (ADR-0007 §3).
 */
export async function draftPlan(context: PlanContext, input: unknown): Promise<DraftPlanResult> {
  if (!mayDraft(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(weekInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<DraftPlanResult> => {
    const planning = await planningOf(tx, { lock: true });
    const week = planWeek(parsed.output.week, planning.calendar);
    const { firstWeek } = planning;
    if (!firstWeek || Temporal.PlainDate.compare(week.start, firstWeek) < 0) {
      return { ok: false, error: 'not-started' };
    }
    const [existing] = await tx
      .select({ id: plans.id, status: plans.status })
      .from(plans)
      .where(eq(plans.weekStart, week.start.toString()));
    if (existing?.status === 'published') return { ok: false, error: 'published' };
    // Running twice changes nothing (CODE-19).
    if (existing && context.member === 'scheduler') {
      return { ok: true, planned: true, planId: existing.id };
    }
    // What heads moved in the draft they replace stays where they put it (ADR-0006 §2).
    const preAssigned = existing ? await headAssigned(tx, existing.id) : new Map<string, string>();
    if (existing) await undoDraft(tx, existing.id);
    const planId = await draftWeek(tx, {
      householdId,
      planning,
      week,
      now: context.clock.now(),
      replacing: existing?.id,
      preAssigned,
    });
    if (planId === undefined) return { ok: true, planned: false };
    return { ok: true, planned: true, planId };
  });
}

/**
 * Undoes what drafting plan `planId` did, so it can be drafted again: what it marked to close isn't
 * marked any more, what it skipped as away is gone, to be skipped again or planned, and its
 * assignments are gone. What it closed already, once its week began, stays closed. Those no plan
 * holds any more go once it is drafted.
 */
async function undoDraft(tx: Transaction, planId: string) {
  await tx
    .update(occurrences)
    .set({ closedByPlan: null })
    .where(
      and(eq(occurrences.closedByPlan, planId), inArray(occurrences.status, ['open', 'done'])),
    );
  await tx
    .delete(occurrences)
    .where(and(eq(occurrences.closedByPlan, planId), eq(occurrences.status, 'away')));
  await tx.delete(assignments).where(eq(assignments.planId, planId));
}

/**
 * The occurrences heads moved in draft `planId`, by their ids, `task@date`, with the members they
 * gave them to (ADR-0006 §2).
 */
async function headAssigned(tx: Transaction, planId: string) {
  const rows = await tx
    .select({ task: occurrences.taskId, date: occurrences.date, member: assignments.memberId })
    .from(assignments)
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .where(and(eq(assignments.planId, planId), eq(assignments.reason, 'assigned by head')));
  return new Map(
    rows.flatMap(({ task, date, member }) =>
      member === null ? [] : [[occurrenceId(task, Temporal.PlainDate.from(date)), member] as const],
    ),
  );
}

/**
 * Removes draft `planId` of a week the household turned out to be away for entirely (ADR-0005 §5).
 * What it closed as its week began, it closed for a week that now has no plan: those are open
 * again, for the next planned week to carry over or close, as anything open when a period away
 * starts follows its on-miss policy.
 */
async function removeDraft(tx: Transaction, planId: string) {
  await tx
    .update(occurrences)
    .set({ status: 'open', closedByPlan: null })
    .where(
      and(eq(occurrences.closedByPlan, planId), inArray(occurrences.status, ['missed', 'away'])),
    );
  await tx.delete(plans).where(eq(plans.id, planId));
}

/** What drafting a week takes. */
interface Draft {
  householdId: string;
  planning: Planning;
  week: PlanWeek;
  /** When it is drafted. */
  now: Temporal.Instant;
  /** The draft of the week being drafted again, if any. */
  replacing: string | undefined;
  /** Members by occurrence id, `task@date`, as heads moved them in the draft it replaces. */
  preAssigned?: ReadonlyMap<string, string>;
}

/**
 * Gathers the week's tasks, members and occurrences, runs the domain over them, and stores the
 * plan; or, for a week the household is away for entirely, removes any draft of it. Returns the
 * plan's id, if it has one. A week drafted once it has begun, as when a household starts now, is
 * planned for the days left: the days already gone count as days away (ADR-0007 §3).
 */
export async function draftWeek(tx: Transaction, draft: Draft): Promise<string | undefined> {
  const { householdId, planning, week } = draft;
  const { calendar } = planning;
  const today = householdDate(draft.now, calendar.timeZone);
  // What earlier weeks close by now isn't in the pool any more.
  await closeDue(tx, draft.now, calendar.timeZone);
  const away = await awayIn(tx, week);
  const household = await tasksOf(tx, calendar.timeZone);
  const earlier = await earlierOccurrences(tx, week, calendar.timeZone);
  // A "since last done" task keeps its one open occurrence by its due date, which the domain gives
  // again each week until it is done, so it isn't carried over as well (ADR-0004 §8).
  const sinceLastDone = new Set(
    household
      .filter(({ task }) => task.recurrence.kind === 'sinceLastDone')
      .map(({ task }) => task.id),
  );
  const weekResult = weekOccurrences({
    week: week.start,
    calendar,
    tasks: household.map(({ task }) => task),
    open: earlier.open.filter((o) => !sinceLastDone.has(o.task)),
    placedEarlier: earlier.placed,
    // Days away since a "since last done" clock started don't count towards it (§8): those periods
    // too, which end before the week and change nothing else about it.
    away: await awaySince(tx, clocksFrom(household) ?? week.start, week),
    today,
  });
  if (!weekResult.planned) {
    if (draft.replacing) await removeDraft(tx, draft.replacing);
    await removeUnplanned(tx);
    return undefined;
  }
  // Shares and availability count over the days at home still to come (ADR-0005 §5, ADR-0007 §3).
  const people = await membersOf(tx, planning, week, [...away, ...goneDays(week, today)]);
  const rules = await rulesByTask(tx);
  const allocation = allocate({
    week: week.start,
    calendar,
    rebalanceRate: rebalanceRates[planning.rebalance],
    members: people,
    // Every burden is the prior until the comparison game brings evidence: 1.0 for a custom task
    // (ADR-0003 §2, clarification).
    tasks: household.map(({ task }): AllocationTask => ({
      id: task.id,
      duration: task.duration,
      burden: new Map(people.map((member) => [member.id, 1])),
      // Who it is for: old enough, and as heads bound, excluded or allowed (ADR-0001 §3).
      ...(rules.get(task.id) ?? { constraints: new Map() }),
    })),
    occurrences: weekResult.occurrences,
    // Those still in the week, for members who are still in the allocation.
    preAssigned: new Map(
      [...(draft.preAssigned ?? [])].filter(
        ([occurrence, member]) =>
          weekResult.occurrences.some((o) => o.id === occurrence) &&
          people.some((person) => person.id === member),
      ),
    ),
    // A link from an occurrence assigned last week goes to the same member (ADR-0001 §7).
    carried: await carriedLinks(
      tx,
      week.start,
      calendar.timeZone,
      new Map(
        [...rules].flatMap(([id, { linkedTo }]) =>
          linkedTo === undefined ? [] : [[id, linkedTo] as const],
        ),
      ),
      weekResult.occurrences,
    ),
  });

  const planId = await storePlan(tx, draft);
  const ids = new Map(earlier.rows);
  const tasksById = new Map(household.map((t) => [t.task.id, t]));
  const fresh = weekResult.occurrences.filter((o) => !ids.has(o.id));
  for (const [id, row] of await storeOccurrences(tx, householdId, fresh, (o) =>
    ownWindow(o, tasksById.get(o.task), planning),
  )) {
    ids.set(id, row);
  }
  const rowOf = (id: string) => {
    const row = ids.get(id);
    if (row === undefined) throw new Error(`No occurrence ${id} was stored.`);
    return row;
  };
  const windows = new Map(weekResult.occurrences.map((o) => [o.id, o.window]));
  const windowOf = (id: string) => {
    const window = windows.get(id);
    if (!window) throw new Error(`No window for ${id}.`);
    return {
      windowStart: new Date(window.start.epochMilliseconds),
      windowEnd: new Date(window.end.epochMilliseconds),
    };
  };
  const rows = [
    ...allocation.assignments.map((a) => ({
      occurrenceId: rowOf(a.occurrence),
      ...windowOf(a.occurrence),
      memberId: a.member,
      cost: a.cost,
      reason: a.reason,
    })),
    ...allocation.unassigned.map((u) => ({
      occurrenceId: rowOf(u.occurrence),
      ...windowOf(u.occurrence),
      unassignedCause: u.cause,
    })),
  ];
  if (rows.length > 0) {
    await tx.insert(assignments).values(rows.map((row) => ({ householdId, planId, ...row })));
  }
  await removeUnplanned(tx);

  // What the week doesn't carry over closes as missed when it begins, if nobody did it by then
  // (ADR-0002 §2, clarifications): now, for a week begun already. Only an occurrence whose whole
  // window falls while the household is away is skipped (ADR-0005 §5): a flexible window is its
  // whole week, which then has no plan, and a floating one is never skipped, so a fixed one.
  await storeSkipped(tx, draft, planId, weekResult.skipped, tasksById);
  const missed = weekResult.missed.map(rowOf);
  if (missed.length > 0) {
    await tx
      .update(occurrences)
      .set({ closedByPlan: planId })
      .where(inArray(occurrences.id, missed));
    await closeDue(tx, draft.now, calendar.timeZone);
  }
  return planId;
}

/** The plan's row: drafted now, as a new one or the same one again. */
async function storePlan(tx: Transaction, draft: Draft) {
  const { week } = draft;
  const draftedAt = new Date(draft.now.epochMilliseconds);
  const values = { weekStart: week.start.toString(), weekEnd: week.end.toString(), draftedAt };
  if (draft.replacing) {
    await tx
      .update(plans)
      .set({ ...values, version: nextVersion(plans) })
      .where(eq(plans.id, draft.replacing));
    return draft.replacing;
  }
  const [plan] = await tx
    .insert(plans)
    .values({ householdId: draft.householdId, ...values, status: 'draft' })
    .returning({ id: plans.id });
  if (!plan) throw new Error('No plan was written.');
  return plan.id;
}

/**
 * Stores the week's new occurrences by their task and date, each with its own window, keeping the
 * row of one an earlier draft of the week stored. Returns their rows' ids by occurrence id.
 */
async function storeOccurrences(
  tx: Transaction,
  householdId: string,
  list: readonly PlannedOccurrence[],
  ownWindowOf: (o: PlannedOccurrence) => Window,
) {
  if (list.length === 0) return new Map<string, string>();
  const rows = await tx
    .insert(occurrences)
    .values(
      list.map((o) => {
        const window = ownWindowOf(o);
        return {
          householdId,
          taskId: o.task,
          date: o.date.toString(),
          windowStart: new Date(window.start.epochMilliseconds),
          windowEnd: new Date(window.end.epochMilliseconds),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [occurrences.householdId, occurrences.taskId, occurrences.date],
      set: { windowStart: sql`excluded.window_start`, windowEnd: sql`excluded.window_end` },
      // One a closed earlier plan holds stays as it is.
      setWhere: eq(occurrences.status, 'open'),
    })
    .returning({ id: occurrences.id, taskId: occurrences.taskId, date: occurrences.date });
  if (rows.length !== list.length) throw new Error('An occurrence of this week is closed already.');
  return new Map(
    rows.map((row) => [occurrenceId(row.taskId, Temporal.PlainDate.from(row.date)), row.id]),
  );
}

/**
 * Stores the occurrences `skipped` by their ids, `task@date`, as away: closed by plan `planId`,
 * with their own windows, so no later week carries them (ADR-0005 §5). Only a fixed task's are.
 */
async function storeSkipped(
  tx: Transaction,
  { householdId, planning }: Draft,
  planId: string,
  skipped: readonly string[],
  tasksById: ReadonlyMap<string, HouseholdTask>,
) {
  if (skipped.length === 0) return;
  const rows = skipped.map((id) => {
    const at = id.lastIndexOf('@');
    const taskId = id.slice(0, at);
    const date = Temporal.PlainDate.from(id.slice(at + 1));
    const recurrence = tasksById.get(taskId)?.task.recurrence;
    if (recurrence?.kind !== 'schedule' || recurrence.timing.kind !== 'fixed') {
      throw new Error(`Only a fixed task's occurrence is skipped, not ${id}.`);
    }
    const [own] = occurrencesOf(
      recurrence.schedule,
      recurrence.timing,
      date,
      date,
      planning.calendar,
    );
    if (!own) throw new Error(`Task ${taskId} has no occurrence on ${date.toString()}.`);
    return {
      householdId,
      taskId,
      date: date.toString(),
      windowStart: new Date(own.window.start.epochMilliseconds),
      windowEnd: new Date(own.window.end.epochMilliseconds),
      status: 'away' as const,
      closedByPlan: planId,
    };
  });
  // One a closed plan holds already, done ahead, say, stays as it is.
  await tx.insert(occurrences).values(rows).onConflictDoNothing();
}

/** Removes the open occurrences no plan holds: those only a replaced draft had. */
async function removeUnplanned(tx: Transaction) {
  await tx
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.status, 'open'),
        notExists(
          tx
            .select({ id: assignments.id })
            .from(assignments)
            .where(eq(assignments.occurrenceId, occurrences.id)),
        ),
      ),
    );
}

/** A task as planning sees it, with its schedule if it has one. */
interface HouseholdTask {
  task: PlanTask;
  schedule?: Schedule;
}

/**
 * The household's tasks, each with its timing and on-miss policy (ADR-0004): on its schedule;
 * "since last done", with the day in `timeZone` it was last done on, if ever (§8); or one-off, on
 * its date and up to its deadline, if it has one (§4).
 */
async function tasksOf(tx: Transaction, timeZone: string): Promise<HouseholdTask[]> {
  const rows = await tx
    .select({
      id: tasks.id,
      duration: tasks.duration,
      ...timingColumns,
      onMiss: tasks.onMiss,
      everyCount: tasks.everyCount,
      everyUnit: tasks.everyUnit,
      start: tasks.start,
      once: tasks.once,
      deadline: tasks.deadline,
      rules: schedules.rules,
      extraDates: schedules.extraDates,
      exceptionDates: schedules.exceptionDates,
    })
    .from(tasks)
    .leftJoin(schedules, eq(schedules.id, tasks.scheduleId))
    // A removed task is never planned again (ADR-0001 §1, clarification).
    .where(eq(tasks.removed, false));
  const lastDone = await lastDoneOf(tx, timeZone);
  return rows.map(({ id, duration, onMiss, everyCount, everyUnit, start, ...stored }) => {
    const { once, deadline, rules, extraDates, exceptionDates } = stored;
    if (once !== null) {
      const recurrence = {
        kind: 'oneOff' as const,
        date: Temporal.PlainDate.from(once),
        ...(deadline !== null && { deadline: Temporal.PlainDate.from(deadline) }),
      };
      return { task: { id, duration, onMiss, recurrence } };
    }
    if (rules && extraDates && exceptionDates) {
      const schedule = scheduleOf({ rules, extraDates, exceptionDates });
      return {
        task: {
          id,
          duration,
          onMiss,
          recurrence: { kind: 'schedule', schedule, timing: timingOf(id, stored) },
        },
        schedule,
      };
    }
    if (everyCount === null || everyUnit === null || start === null) {
      throw new Error(`Task ${id} has neither a schedule nor an interval.`);
    }
    const done = lastDone.get(id);
    return {
      task: {
        id,
        duration,
        onMiss,
        recurrence: {
          kind: 'sinceLastDone',
          every: { count: everyCount, unit: everyUnit },
          start: Temporal.PlainDate.from(start),
          ...(done && { lastDone: done }),
        },
      },
    };
  });
}

/** The earliest day a "since last done" clock counts from: a last completion or a start. */
function clocksFrom(household: readonly HouseholdTask[]) {
  let earliest: Temporal.PlainDate | undefined;
  for (const { task } of household) {
    const r = task.recurrence;
    if (r.kind !== 'sinceLastDone') continue;
    const from = r.lastDone ?? r.start;
    if (!earliest || Temporal.PlainDate.compare(from, earliest) < 0) earliest = from;
  }
  return earliest;
}

/**
 * The occurrences of earlier plan weeks that matter to this one: those still open, which go back
 * into its pool with their own windows (ADR-0002 §2), unless their task was removed (ADR-0001 §1,
 * clarification), and the floating ones placed already, by id (ADR-0004 §4). Those placed more than
 * a year ago no longer float into it.
 */
async function earlierOccurrences(tx: Transaction, week: PlanWeek, timeZone: string) {
  const inEarlierPlans = inArray(
    occurrences.id,
    tx
      .select({ id: assignments.occurrenceId })
      .from(assignments)
      .innerJoin(plans, eq(plans.id, assignments.planId))
      .where(lt(plans.weekStart, week.start.toString())),
  );
  const open = await tx
    .select({
      id: occurrences.id,
      taskId: occurrences.taskId,
      date: occurrences.date,
      windowStart: occurrences.windowStart,
      windowEnd: occurrences.windowEnd,
    })
    .from(occurrences)
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(and(eq(occurrences.status, 'open'), eq(tasks.removed, false), inEarlierPlans));
  const placed = await tx
    .select({ taskId: occurrences.taskId, date: occurrences.date })
    .from(occurrences)
    .where(
      and(inEarlierPlans, gte(occurrences.date, week.start.subtract({ years: 1 }).toString())),
    );
  const zoned = (at: Date) =>
    Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
  const idOf = (row: { taskId: string; date: string }) =>
    occurrenceId(row.taskId, Temporal.PlainDate.from(row.date));
  return {
    open: open.map((row): PlannedOccurrence => ({
      id: idOf(row),
      task: row.taskId,
      date: Temporal.PlainDate.from(row.date),
      window: { start: zoned(row.windowStart), end: zoned(row.windowEnd) },
    })),
    /** The rows of the open ones, by occurrence id. */
    rows: new Map(open.map((row) => [idOf(row), row.id])),
    placed: new Set(placed.map(idOf)),
  };
}

/**
 * A new occurrence's own window, as `occurrences` gives it: for a floating one, the weeks it may
 * float over, not the part of them in this week; for a one-off, its week or up to its deadline
 * (ADR-0004 §4). Any other is due this week, with its own window.
 */
function ownWindow(o: PlannedOccurrence, task: HouseholdTask | undefined, planning: Planning) {
  if (!task) throw new Error(`No task ${o.task}.`);
  const { recurrence } = task.task;
  if (recurrence.kind === 'oneOff') {
    return oneOffOccurrence(recurrence.date, recurrence.deadline, planning.calendar).window;
  }
  if (recurrence.kind !== 'schedule' || recurrence.timing.kind !== 'floating') return o.window;
  const [own] = occurrencesOf(
    recurrence.schedule,
    recurrence.timing,
    o.date,
    o.date,
    planning.calendar,
  );
  if (!own) throw new Error(`Task ${o.task} has no occurrence on ${o.date.toString()}.`);
  return own.window;
}
