import {
  absences,
  assignments,
  inHousehold,
  members,
  nextVersion,
  occurrences,
  plans,
  schedules,
  tasks,
  temporaryShares,
  type Transaction,
} from '@householdr/db';
import {
  allocate,
  availabilityInWeek,
  fairFractions,
  occurrenceId,
  occurrences as occurrencesOf,
  planWeek,
  rebalanceRates,
  weekOccurrences,
  weekShare,
  type Absence,
  type AllocationMember,
  type AllocationTask,
  type PlannedOccurrence,
  type PlanTask,
  type PlanWeek,
  type Schedule,
  type Window,
} from '@householdr/domain';
import { and, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import * as v from 'valibot';
import { basisOf } from '../shares/member-share';
import { scheduleOf } from '../tasks/stored-schedule';
import {
  awayIn,
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
 * places, each given to a member or left unassigned for the heads. What the week closes as missed
 * by its task's on-miss policy, it closes (ADR-0002 §2). The scheduler drafts a week once; a head
 * drafting it again while it is a draft replaces it. A week the household is away for entirely gets
 * no plan (ADR-0005 §5).
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
    if (existing) await undoDraft(tx, existing.id);
    const at = new Date(context.clock.now().epochMilliseconds);
    const planId = await draftWeek(tx, {
      householdId,
      planning,
      week,
      at,
      replacing: existing?.id,
    });
    if (planId === undefined) return { ok: true, planned: false };
    return { ok: true, planned: true, planId };
  });
}

/**
 * Undoes what drafting plan `planId` did, so it can be drafted again: the occurrences it closed are
 * open again, and its assignments are gone. Those no plan holds any more go once it is drafted.
 */
async function undoDraft(tx: Transaction, planId: string) {
  await tx
    .update(occurrences)
    .set({ status: 'open', closedByPlan: null })
    .where(eq(occurrences.closedByPlan, planId));
  await tx.delete(assignments).where(eq(assignments.planId, planId));
}

interface Draft {
  householdId: string;
  planning: Planning;
  week: PlanWeek;
  at: Date;
  /** The draft of the week being drafted again, if any. */
  replacing: string | undefined;
}

/**
 * Gathers the week's tasks, members and occurrences, runs the domain over them, and stores the
 * plan; or, for a week the household is away for entirely, removes any draft of it. Returns the
 * plan's id, if it has one.
 */
async function draftWeek(tx: Transaction, draft: Draft): Promise<string | undefined> {
  const { householdId, planning, week } = draft;
  const { calendar } = planning;
  const away = await awayIn(tx, week);
  const household = await tasksOf(tx);
  const earlier = await earlierOccurrences(tx, week, calendar.timeZone);
  const weekResult = weekOccurrences({
    week: week.start,
    calendar,
    tasks: household.map(({ task }) => task),
    open: earlier.open,
    placedEarlier: earlier.placed,
    away,
  });
  if (!weekResult.planned) {
    if (draft.replacing) await tx.delete(plans).where(eq(plans.id, draft.replacing));
    await removeUnplanned(tx);
    return undefined;
  }
  const people = await membersOf(tx, planning, week, away);
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
      constraints: new Map(),
    })),
    occurrences: weekResult.occurrences,
    preAssigned: new Map(),
    carried: new Map(),
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

  // What the week closes as missed (ADR-0002 §2). Only an occurrence whose whole window falls
  // while the household is away is skipped (ADR-0005 §5): a flexible window is its whole week,
  // which then has no plan, and a floating one is never skipped. Fixed windows bring the first.
  if (weekResult.skipped.length > 0) throw new Error('Skipped occurrences are not stored yet.');
  const missed = weekResult.missed.map(rowOf);
  if (missed.length > 0) {
    await tx
      .update(occurrences)
      .set({ status: 'missed', closedByPlan: planId })
      .where(inArray(occurrences.id, missed));
  }
  return planId;
}

/** The plan's row: drafted now, as a new one or the same one again. */
async function storePlan(tx: Transaction, draft: Draft) {
  const { week, at } = draft;
  const values = { weekStart: week.start.toString(), weekEnd: week.end.toString(), draftedAt: at };
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

/** A task as planning sees it, with its schedule. */
interface HouseholdTask {
  task: PlanTask;
  schedule: Schedule;
}

/** The household's tasks, each on its schedule, with its timing and on-miss policy (ADR-0004). */
async function tasksOf(tx: Transaction): Promise<HouseholdTask[]> {
  const rows = await tx
    .select({
      id: tasks.id,
      duration: tasks.duration,
      timing: tasks.timing,
      onMiss: tasks.onMiss,
      rules: schedules.rules,
      extraDates: schedules.extraDates,
      exceptionDates: schedules.exceptionDates,
    })
    .from(tasks)
    .innerJoin(schedules, eq(schedules.id, tasks.scheduleId));
  return rows.map(({ id, duration, timing, onMiss, ...stored }) => {
    const schedule = scheduleOf(stored);
    return {
      task: {
        id,
        duration,
        onMiss,
        recurrence: { kind: 'schedule', schedule, timing: { kind: timing } },
      },
      schedule,
    };
  });
}

/**
 * The occurrences of earlier plan weeks that matter to this one: those still open, which go back
 * into its pool with their own windows (ADR-0002 §2), and the floating ones placed already, by id
 * (ADR-0004 §4). Those placed more than a year ago no longer float into it.
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
    .where(and(eq(occurrences.status, 'open'), inEarlierPlans));
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
 * The members as the allocator sees them (ADR-0001 §6–§7): their fair portion of the week from
 * their share, temporary ones included, and the time they are available, both over the days the
 * household is at home (ADR-0005 §5); a child's birth date; a balance of 0 until the ledger exists
 * (ADR-0002); and the tasks they had in last week's plan.
 */
async function membersOf(
  tx: Transaction,
  planning: Planning,
  week: PlanWeek,
  away: readonly Absence[],
): Promise<AllocationMember[]> {
  const { calendar } = planning;
  // Those of a period that touches the week: its last day in or after it, its first before its end.
  const inWeek = (first: AnyPgColumn, last: AnyPgColumn) =>
    and(gte(last, week.start.toString()), lt(first, week.end.toString()));
  const rows = await tx
    .select({
      id: members.id,
      role: members.role,
      birthDate: members.birthDate,
      sharePercent: members.sharePercent,
    })
    .from(members);
  const absent = await tx
    .select({ memberId: absences.memberId, from: absences.firstDay, to: absences.lastDay })
    .from(absences)
    .where(inWeek(absences.firstDay, absences.lastDay));
  const temporary = await tx
    .select({
      memberId: temporaryShares.memberId,
      from: temporaryShares.firstDay,
      to: temporaryShares.lastDay,
      percent: temporaryShares.percent,
    })
    .from(temporaryShares)
    .where(inWeek(temporaryShares.firstDay, temporaryShares.lastDay));
  const lastWeek = await tx
    .select({ memberId: assignments.memberId, taskId: occurrences.taskId })
    .from(assignments)
    .innerJoin(plans, eq(plans.id, assignments.planId))
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .where(eq(plans.weekEnd, week.start.toString()));
  const day = (iso: string) => Temporal.PlainDate.from(iso);
  const people = rows.map((row) => {
    const share = weekShare(
      {
        basis: basisOf(row),
        ...(row.sharePercent === null ? {} : { override: row.sharePercent / 100 }),
        temporary: temporary
          .filter((t) => t.memberId === row.id)
          .map((t) => ({ from: day(t.from), to: day(t.to), share: t.percent / 100 })),
      },
      week.start,
      calendar,
      away,
    );
    const availability = {
      absences: [
        ...absent
          .filter((a) => a.memberId === row.id)
          .map((a) => ({ from: day(a.from), to: day(a.to) })),
        // The days the household is away count as nobody's: the week is planned for the days at
        // home, with fair portions over those days (ADR-0005 §5).
        ...away,
      ],
      unavailable: [],
    };
    return { row, share, availability };
  });
  const fractions = fairFractions(
    people.map(({ share, availability }) => ({
      share,
      availability: availabilityInWeek(availability, week.start, calendar),
    })),
  );
  return people.map(({ row, availability }, index) => ({
    id: row.id,
    fairFraction: fractions[index] ?? 0,
    availability,
    ...(row.birthDate === null ? {} : { birthDate: day(row.birthDate) }),
    balance: 0,
    load: 0,
    lastWeek: new Set(lastWeek.filter((a) => a.memberId === row.id).map((a) => a.taskId)),
  }));
}

/**
 * A new occurrence's own window, as `occurrences` gives it: for a floating one, the weeks it may
 * float over, not the part of them in this week (ADR-0004 §4). Any other is due this week, with
 * its own window.
 */
function ownWindow(o: PlannedOccurrence, task: HouseholdTask | undefined, planning: Planning) {
  if (!task) throw new Error(`No task ${o.task}.`);
  const { recurrence } = task.task;
  if (recurrence.kind !== 'schedule' || recurrence.timing.kind !== 'floating') return o.window;
  const [own] = occurrencesOf(task.schedule, recurrence.timing, o.date, o.date, planning.calendar);
  if (!own) throw new Error(`Task ${o.task} has no occurrence on ${o.date.toString()}.`);
  return own.window;
}
