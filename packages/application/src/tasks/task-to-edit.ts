import { households, inHousehold, schedules, tasks, type Transaction } from '@householdr/db';
import { can, changedStartRange, scheduleDateRange } from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { tasksBySchedule, othersOn, type TaskName } from './shared-schedules';
import { repeatColumns, repeatOf, type TaskRepeat } from './stored-task';
import { constrainedMembers, rulesOf, type ConstrainedMember, type TaskRules } from './task-rules';
import { taskReference } from './task-fields';

/** A task as the form that changes it shows it, with the version it is changed from (ADR-0019 §5). */
export interface EditableTask extends TaskRepeat, TaskRules {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  version: number;
  /** The other tasks on its schedule, by name (ADR-0004 §1, clarification). */
  sharedWith: TaskName[];
}

/**
 * The task `taskId` of the household `tx` works in, and the id and version of its schedule if it
 * has one, or nothing if the household has no such task.
 */
export async function readTask(tx: Transaction, taskId: string) {
  const [row] = await tx
    .select({
      id: tasks.id,
      name: tasks.name,
      duration: tasks.duration,
      version: tasks.version,
      scheduleId: schedules.id,
      scheduleVersion: schedules.version,
      minimumAge: tasks.minimumAge,
      ...repeatColumns,
    })
    .from(tasks)
    .leftJoin(schedules, eq(schedules.id, tasks.scheduleId))
    // A removed task is hidden for good (ADR-0001 §1, clarification).
    .where(and(eq(tasks.id, taskId), eq(tasks.removed, false)));
  if (!row) return undefined;
  const { id, name, duration, version, scheduleId, scheduleVersion } = row;
  const sharedWith = othersOn(await tasksBySchedule(tx), scheduleId, id);
  const rules = await rulesOf(tx, id, row.minimumAge);
  const task: EditableTask = {
    id,
    name,
    duration,
    version,
    sharedWith,
    ...rules,
    ...repeatOf(id, row),
  };
  const schedule =
    scheduleId === null || scheduleVersion === null
      ? undefined
      : { id: scheduleId, version: scheduleVersion };
  return { task, schedule };
}

type TaskToEditResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      task: EditableTask;
      /** The days its date picker offers for its first time (`changedStartRange`). */
      starts: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
      /**
       * The days its pickers offer for an extra or exception date (`scheduleDateRange`), stretched
       * to the earliest it has already (ADR-0004 §3, clarification).
       */
      dates: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
      /** Today in the household's time zone: the first time a rule added to it starts with. */
      today: Temporal.PlainDate;
      /** The tasks on another calendar schedule, whose dates it can share (ADR-0004 §1). */
      shareable: TaskName[];
      /** The household's members, by name, for its constraints (ADR-0001 §3, clarification). */
      members: ConstrainedMember[];
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
    const { earliest, latest } = scheduleDateRange(today);
    const kept = [
      ...(found.task.schedule?.extraDates ?? []),
      ...(found.task.schedule?.exceptionDates ?? []),
    ];
    return {
      ok: true,
      household: household.name,
      task: found.task,
      starts: changedStartRange(today, found.task.start),
      dates: {
        earliest: [earliest, ...kept].reduce((a, b) =>
          Temporal.PlainDate.compare(a, b) <= 0 ? a : b,
        ),
        latest,
      },
      today,
      shareable: [...(await tasksBySchedule(tx)).entries()]
        .filter(([scheduleId]) => scheduleId !== found.schedule?.id)
        .flatMap(([, names]) => names)
        .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      members: await constrainedMembers(tx),
    };
  });
}
