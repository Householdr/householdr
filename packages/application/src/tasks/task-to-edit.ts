import { households, inHousehold, schedules, tasks, type Transaction } from '@householdr/db';
import {
  can,
  changedStartRange,
  frequencyOf,
  type Frequency,
  type PlanTask,
} from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { scheduleOf } from './stored-schedule';
import { taskReference } from './task-fields';

/** A task as the form that changes it shows it, with the version it is changed from (ADR-0019 §5). */
export interface EditableTask {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  frequency: Frequency;
  /** The day its schedule's rule starts on: its first time (ADR-0004 §3). */
  start: Temporal.PlainDate;
  /** What happens to an occurrence that isn't done (ADR-0002 §2). */
  onMiss: PlanTask['onMiss'];
  version: number;
}

/**
 * The task `taskId` of the household `tx` works in, and the id and version of its schedule, or
 * nothing if the household has no such task.
 */
export async function readTask(tx: Transaction, taskId: string) {
  const [row] = await tx
    .select({
      id: tasks.id,
      name: tasks.name,
      duration: tasks.duration,
      onMiss: tasks.onMiss,
      version: tasks.version,
      scheduleId: schedules.id,
      scheduleVersion: schedules.version,
      rules: schedules.rules,
      extraDates: schedules.extraDates,
      exceptionDates: schedules.exceptionDates,
    })
    .from(tasks)
    .innerJoin(schedules, eq(schedules.id, tasks.scheduleId))
    .where(eq(tasks.id, taskId));
  if (!row) return undefined;
  const { id, name, duration, onMiss, version, scheduleId, scheduleVersion, ...stored } = row;
  const schedule = scheduleOf(stored);
  const frequency = frequencyOf(schedule);
  const [rule] = schedule.rules;
  // Only simple frequencies are written until the advanced editor comes (ADR-0004 §3).
  if (!frequency || !rule) throw new Error(`Task ${id} isn't on a simple frequency.`);
  const task: EditableTask = {
    id,
    name,
    duration,
    frequency,
    start: rule.start,
    onMiss,
    version,
  };
  return { task, schedule: { id: scheduleId, version: scheduleVersion } };
}

type TaskToEditResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      task: EditableTask;
      /** The days its date picker offers for its first time (`changedStartRange`). */
      starts: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
    }
  /** Only heads change tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such task, or no longer. */
  | { ok: false; error: 'not-found' };

/** A task of the household, for a head to change or remove (ADR-0001 §2). */
export async function taskToEdit(
  context: HouseholdContext,
  input: unknown,
): Promise<TaskToEditResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<TaskToEditResult> => {
    const [household] = await tx
      .select({ name: households.name, timeZone: households.timeZone })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const found = await readTask(tx, target.output.taskId);
    if (!found) return { ok: false, error: 'not-found' };
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    return {
      ok: true,
      household: household.name,
      task: found.task,
      starts: changedStartRange(today, found.task.start),
    };
  });
}
