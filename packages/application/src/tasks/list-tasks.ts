import { awayPeriods, households, inHousehold, schedules, tasks } from '@householdr/db';
import {
  can,
  dueness,
  startRange,
  type Dueness,
  type Interval,
  type PlanTask,
} from '@householdr/domain';
import { and, eq, gte, isNull } from 'drizzle-orm';
import type { HouseholdContext } from '../households/membership';
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
  /** For a "since last done" task: how long after it is due again, and how due it is now (ADR-0004 §8). */
  every?: Interval;
  dueness?: Dueness;
  /** What happens to an occurrence that isn't done (ADR-0002 §2). */
  onMiss: PlanTask['onMiss'];
}

type ListTasksResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      tasks: TaskSummary[];
      /** Whether the member may add, change and remove tasks: a head with two factors (ADR-0001 §2). */
      mayChangeTasks: boolean;
      /** The days a new task can start on, from today in the household's time zone. */
      starts: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
    }
  | { ok: false; error: 'not-allowed' };

/**
 * The household's tasks by name, each with how often it is done and its on-miss policy, which every
 * member sees (ADR-0012 §3), and what adding one needs. A "since last done" task also shows how
 * due it is today, counting days at home only (ADR-0004 §8).
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
      // One-off tasks are listed once members can add them; removed ones never (ADR-0001 §1).
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
      const { frequency, every, start, onMiss } = repeat;
      if (!every) return { id, name, duration, frequency, onMiss };
      const due = dueness({ every, start }, lastDone.get(id), away, today);
      return { id, name, duration, frequency, every, dueness: due, onMiss };
    });
    list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      ok: true as const,
      household: household.name,
      tasks: list,
      mayChangeTasks: can(context.member, { action: 'household.tasks' }),
      starts: startRange(today),
    };
  });
}
