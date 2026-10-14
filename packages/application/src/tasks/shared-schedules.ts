import { schedules, tasks, type Transaction } from '@householdr/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { scheduleOf } from './stored-schedule';

/** A task of the household, by its name, as a choice of whose dates to share. */
export interface TaskName {
  id: string;
  name: string;
}

/**
 * The schedule of task `taskId` in the household `tx` works in, to share (ADR-0004 §1,
 * clarification): its id and its dates, if it is a task the household has, on a calendar schedule.
 */
export async function scheduleToShare(tx: Transaction, taskId: string) {
  const [row] = await tx
    .select({
      id: schedules.id,
      rules: schedules.rules,
      extraDates: schedules.extraDates,
      exceptionDates: schedules.exceptionDates,
    })
    .from(tasks)
    .innerJoin(schedules, eq(schedules.id, tasks.scheduleId))
    .where(and(eq(tasks.id, taskId), eq(tasks.removed, false)));
  return row && { id: row.id, schedule: scheduleOf(row) };
}

/**
 * The household's tasks on a calendar schedule, by name, grouped by their schedule: those that
 * share one are in the same group (ADR-0004 §1, clarification).
 */
export async function tasksBySchedule(tx: Transaction): Promise<Map<string, TaskName[]>> {
  const rows = await tx
    .select({ id: tasks.id, name: tasks.name, scheduleId: tasks.scheduleId })
    .from(tasks)
    .where(and(isNotNull(tasks.scheduleId), eq(tasks.removed, false)));
  const bySchedule = new Map<string, TaskName[]>();
  const byName = rows.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const { id, name, scheduleId } of byName) {
    if (scheduleId !== null)
      bySchedule.set(scheduleId, [...(bySchedule.get(scheduleId) ?? []), { id, name }]);
  }
  return bySchedule;
}

/** The other tasks on the schedule `scheduleId`, given the household's tasks by schedule. */
export function othersOn(
  bySchedule: Map<string, TaskName[]>,
  scheduleId: string | null,
  taskId: string,
): TaskName[] {
  if (scheduleId === null) return [];
  return (bySchedule.get(scheduleId) ?? []).filter(({ id }) => id !== taskId);
}
