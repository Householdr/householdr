import { activityLog, occurrences, tasks, type Transaction } from '@householdr/db';
import type { PlanTask } from '@householdr/domain';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { HouseholdContext } from '../households/membership';

/**
 * A one-off task as the form that changes it shows it, with the version it is changed from
 * (ADR-0019 §5).
 */
export interface EditableOneOff {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  /** Its one date (ADR-0004 §4). */
  date: Temporal.PlainDate;
  /** The last day it can be done on, if it floats up to one. */
  deadline?: Temporal.PlainDate;
  onMiss: PlanTask['onMiss'];
  version: number;
}

/**
 * The one-off task `taskId` of the household `tx` works in, unless removed, with who added it and
 * whether it is done, which say who may change it (ADR-0006 §3, clarification); or nothing.
 */
export async function readOneOff(tx: Transaction, taskId: string) {
  const [row] = await tx
    .select({
      id: tasks.id,
      name: tasks.name,
      duration: tasks.duration,
      once: tasks.once,
      deadline: tasks.deadline,
      onMiss: tasks.onMiss,
      version: tasks.version,
      addedBy: tasks.addedBy,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNotNull(tasks.once), eq(tasks.removed, false)));
  if (!row?.once || !row.addedBy) return undefined;
  const [done] = await tx
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, 'done')))
    .limit(1);
  const { once, deadline, addedBy, ...rest } = row;
  const oneOff: EditableOneOff = {
    ...rest,
    date: Temporal.PlainDate.from(once),
    ...(deadline !== null && { deadline: Temporal.PlainDate.from(deadline) }),
  };
  return { oneOff, addedBy, done: done !== undefined };
}

/**
 * Logs that the member of `context` added or removed the one-off task `name`: an entry of the
 * activity log naming the task, which every member sees in the task list anyway (ADR-0018 §5,
 * clarification).
 */
export async function logOneOff(
  tx: Transaction,
  context: HouseholdContext,
  action: 'one-off.added' | 'one-off.removed',
  name: string,
) {
  await tx.insert(activityLog).values({
    householdId: context.householdId,
    at: new Date(context.clock.now().epochMilliseconds),
    actorId: context.member.id,
    action,
    taskName: name,
  });
}
