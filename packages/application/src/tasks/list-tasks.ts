import {
  awayPeriods,
  completions,
  households,
  inHousehold,
  occurrences,
  plans,
  schedules,
  tasks,
  type Transaction,
} from '@householdr/db';
import {
  can,
  dueness,
  planWeek,
  scheduleDateRange,
  startRange,
  type AdvancedSchedule,
  type Dueness,
  type Interval,
  type Member,
  type PlanTask,
  type WindowEdge,
} from '@householdr/domain';
import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from '../plans/planning';
import { lastDoneOf } from './last-done';
import { repeatColumns, repeatOf } from './stored-task';
import type { Repeat } from './task-fields';

/** A task of the household, as its list shows it (ADR-0001 §1). */
export interface TaskSummary {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  frequency: Repeat;
  /** For a task on an advanced schedule: its rules and dates, which the list says in words (ADR-0004 §3). */
  schedule?: AdvancedSchedule;
  /** For a "since last done" task: how long after it is due again, and how due it is now (ADR-0004 §8). */
  every?: Interval;
  dueness?: Dueness;
  /** What happens to an occurrence that isn't done (ADR-0002 §2). */
  onMiss: PlanTask['onMiss'];
  /** At set times: the window around each date (ADR-0004 §4, clarification). */
  window?: { from: WindowEdge; to: WindowEdge };
}

/** A one-off task of the household, as its list shows it (ADR-0004 §4, ADR-0006 §3). */
export interface OneOffSummary {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  /** Its one date, and the last day it can be done on if it floats up to one. */
  date: Temporal.PlainDate;
  deadline?: Temporal.PlainDate;
  onMiss: PlanTask['onMiss'];
  /** Done this plan week: it stays in the list, marked done, until the next one begins. */
  done: boolean;
  /** Whether the member may change or remove it: who added it, until it is done, or a head. */
  mayChange: boolean;
}

type ListTasksResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      tasks: TaskSummary[];
      /** By date, then name. */
      oneOffs: OneOffSummary[];
      /** Whether the member may add one-off tasks: every member with an account (ADR-0006 §3). */
      mayAddOneOffs: boolean;
      /** Whether the member may add, change and remove tasks: a head with two factors (ADR-0001 §2). */
      mayChangeTasks: boolean;
      /** The days a new task can start on, from today in the household's time zone. */
      starts: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
      /** The days a new task's extra and exception dates can be on (ADR-0004 §3, clarification). */
      dates: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
    }
  | { ok: false; error: 'not-allowed' };

/**
 * The household's tasks by name, each with how often it is done and its on-miss policy, which every
 * member sees (ADR-0012 §3), and what adding one needs. A "since last done" task also shows how
 * due it is today, counting days at home only (ADR-0004 §8). Its one-off tasks come apart, by
 * date: those still to do, and those done this plan week, until the next one begins (ADR-0006 §3,
 * clarification).
 */
export async function listTasks(context: HouseholdContext): Promise<ListTasksResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx
      .select({ name: households.name, timeZone: households.timeZone })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    const rows = await tx
      .select({ id: tasks.id, name: tasks.name, duration: tasks.duration, ...repeatColumns })
      .from(tasks)
      .leftJoin(schedules, eq(schedules.id, tasks.scheduleId))
      // One-off tasks are listed apart; removed ones never (ADR-0001 §1, clarification).
      .where(and(isNull(tasks.once), eq(tasks.removed, false)));
    const repeats = rows.map((row) => ({ row, repeat: repeatOf(row.id, row) }));
    const counted = repeats.filter(({ repeat }) => repeat.every);
    const lastDone =
      counted.length > 0
        ? await lastDoneOf(tx, household.timeZone)
        : new Map<string, Temporal.PlainDate>();
    // The household's days away from the earliest day a clock counts from: those still to come
    // move a due date on too.
    let from: Temporal.PlainDate | undefined;
    for (const { row, repeat } of counted) {
      const since = lastDone.get(row.id) ?? repeat.start;
      if (!from || Temporal.PlainDate.compare(since, from) < 0) from = since;
    }
    const away = from
      ? (
          await tx
            .select({ from: awayPeriods.firstDay, to: awayPeriods.lastDay })
            .from(awayPeriods)
            .where(gte(awayPeriods.lastDay, from.toString()))
        ).map((period) => ({
          from: Temporal.PlainDate.from(period.from),
          to: Temporal.PlainDate.from(period.to),
        }))
      : [];
    const list = repeats.map(({ row, repeat }): TaskSummary => {
      const { id, name, duration } = row;
      const { frequency, every, schedule, start, onMiss, window } = repeat;
      if (!every) {
        return {
          id,
          name,
          duration,
          frequency,
          onMiss,
          ...(schedule && { schedule }),
          ...(window && { window }),
        };
      }
      const due = dueness({ every, start }, lastDone.get(id), away, today);
      return { id, name, duration, frequency, every, dueness: due, onMiss };
    });
    list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      ok: true as const,
      household: household.name,
      tasks: list,
      oneOffs: await oneOffsOf(tx, context.member, today),
      mayAddOneOffs: can(context.member, { action: 'oneOff.add' }),
      mayChangeTasks: can(context.member, { action: 'household.tasks' }),
      starts: startRange(today),
      dates: scheduleDateRange(today),
    };
  });
}

/**
 * The household's one-off tasks as `member` sees them in the list on `today`, by date: those still
 * to do, and those done in this plan week, which stay, marked done, until the next one begins
 * (ADR-0006 §3, clarification). One that closed as missed, or was skipped while the household was
 * away, is no longer to do. One that is done, though another occurrence is still open after its
 * date changed, is done, as who may change it goes by.
 */
async function oneOffsOf(
  tx: Transaction,
  member: Member,
  today: Temporal.PlainDate,
): Promise<OneOffSummary[]> {
  const { calendar } = await planningOf(tx);
  const thisWeek = planWeek(today, calendar).start.toString();
  const rows = await tx
    .select({
      id: tasks.id,
      name: tasks.name,
      duration: tasks.duration,
      once: tasks.once,
      deadline: tasks.deadline,
      onMiss: tasks.onMiss,
      addedBy: tasks.addedBy,
      status: occurrences.status,
      doneIn: plans.weekStart,
    })
    .from(tasks)
    .leftJoin(occurrences, eq(occurrences.taskId, tasks.id))
    .leftJoin(completions, eq(completions.occurrenceId, occurrences.id))
    .leftJoin(plans, eq(plans.id, completions.planId))
    .where(and(isNotNull(tasks.once), eq(tasks.removed, false)));
  // Several rows for a one-off whose date changed once it was planned: one for each occurrence.
  const byTask = Map.groupBy(rows, (row) => row.id);
  const list = [...byTask.values()].flatMap((occurrencesOf): OneOffSummary[] => {
    const [first] = occurrencesOf;
    if (!first || first.once === null || first.addedBy === null) return [];
    const { id, name, duration, once, deadline, onMiss, addedBy } = first;
    const done = occurrencesOf.some(({ status }) => status === 'done');
    const doneThisWeek = occurrencesOf.some(
      ({ status, doneIn }) => status === 'done' && doneIn === thisWeek,
    );
    const toDo = occurrencesOf.some(({ status }) => status === null || status === 'open');
    if (!toDo && !doneThisWeek) return [];
    return [
      {
        id,
        name,
        duration,
        date: Temporal.PlainDate.from(once),
        ...(deadline !== null && { deadline: Temporal.PlainDate.from(deadline) }),
        onMiss,
        done,
        mayChange: can(member, { action: 'oneOff.edit', addedBy, done }),
      },
    ];
  });
  return list.sort(
    (a, b) =>
      Temporal.PlainDate.compare(a.date, b.date) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
