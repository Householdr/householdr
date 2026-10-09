import { atVersion, inHousehold, schedules, tasks } from '@householdr/db';
import { can } from '@householdr/domain';
import { and, eq, notExists } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { taskReference, version } from './task-fields';
import { readTask, type EditableTask } from './task-to-edit';

type RemoveTaskResult =
  | { ok: true }
  /** Only heads remove tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such task, or no longer. */
  | { ok: false; error: 'not-found' }
  /** No version the task could have had, as only a tampered form sends. */
  | { ok: false; error: 'invalid' }
  /**
   * Someone changed it since the confirmation was loaded, so it wasn't removed: the task now
   * (ADR-0019 §5).
   */
  | { ok: false; error: 'conflict'; current: EditableTask };

/**
 * Removes a task, by a head (ADR-0001 §2), as they saw it when they confirmed: from the version
 * the confirmation was loaded with, as an edit is (ADR-0019 §5), so a task changed in the meantime
 * is never removed unseen. Its schedule goes with it, unless another task uses it too (ADR-0004
 * §1).
 */
export async function removeTask(
  context: HouseholdContext,
  input: unknown,
): Promise<RemoveTaskResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const seen = v.safeParse(v.looseObject({ version }), input);
  if (!seen.success) return { ok: false, error: 'invalid' };
  const { taskId } = target.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<RemoveTaskResult> => {
    const [removed] = await tx
      .delete(tasks)
      .where(atVersion(tasks, taskId, seen.output.version))
      .returning({ scheduleId: tasks.scheduleId });
    if (!removed) {
      const found = await readTask(tx, taskId);
      return found
        ? { ok: false, error: 'conflict', current: found.task }
        : { ok: false, error: 'not-found' };
    }
    const { scheduleId } = removed;
    await tx
      .delete(schedules)
      .where(
        and(
          eq(schedules.id, scheduleId),
          notExists(
            tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.scheduleId, scheduleId)),
          ),
        ),
      );
    return { ok: true };
  });
}
