import {
  assignments,
  atVersion,
  inHousehold,
  nextVersion,
  occurrences,
  plans,
  schedules,
  tasks,
  type Transaction,
} from '@householdr/db';
import { can, householdDate } from '@householdr/domain';
import { and, eq, gt, inArray, notExists, or } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from '../plans/planning';
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
 * is never removed unseen. It goes from drafts and from plans whose week isn't over, where nobody
 * did it yet. A task that has been in a plan otherwise is hidden, not deleted: done work, past plans
 * and the balances keep it by its name (ADR-0001 §1, clarification). Any other goes, with its
 * schedule unless another task uses it too (ADR-0004 §1).
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
    // Locked, as drafting locks it, so no draft being made meanwhile plans the task again.
    const { calendar } = await planningOf(tx, { lock: true });
    const [claimed] = await tx
      .update(tasks)
      .set({ version: nextVersion(tasks) })
      .where(and(atVersion(tasks, taskId, seen.output.version), eq(tasks.removed, false)))
      .returning({ scheduleId: tasks.scheduleId });
    if (!claimed) {
      const found = await readTask(tx, taskId);
      return found
        ? { ok: false, error: 'conflict', current: found.task }
        : { ok: false, error: 'not-found' };
    }
    await unplan(tx, taskId, householdDate(context.clock.now(), calendar.timeZone));
    const [kept] = await tx
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(eq(occurrences.taskId, taskId))
      .limit(1);
    if (kept) {
      await tx.update(tasks).set({ removed: true }).where(eq(tasks.id, taskId));
      return { ok: true };
    }
    await tx.delete(tasks).where(eq(tasks.id, taskId));
    const { scheduleId } = claimed;
    // A "since last done" task has none (ADR-0004 §8).
    if (scheduleId === null) return { ok: true };
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

/**
 * Takes task `taskId`'s occurrences nobody did yet out of the drafts, and out of the published plans
 * whose week isn't over on `today`: this week's, and any published early (ADR-0001 §1,
 * clarification). A draft that changes moves on to a new version, so a head publishes it as it is
 * now (ADR-0019 §5). Those no plan holds any more go; one an earlier week's plan still holds stays
 * in it, as it was.
 */
async function unplan(tx: Transaction, taskId: string, today: Temporal.PlainDate) {
  // Locked, as completing one locks it, so one done meanwhile keeps its place in the plan.
  const open = await tx
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, 'open')))
    .for('update');
  if (open.length === 0) return;
  const ids = open.map(({ id }) => id);
  const dropped = await tx
    .delete(assignments)
    .where(
      and(
        inArray(assignments.occurrenceId, ids),
        inArray(
          assignments.planId,
          tx
            .select({ id: plans.id })
            .from(plans)
            .where(or(eq(plans.status, 'draft'), gt(plans.weekEnd, today.toString()))),
        ),
      ),
    )
    .returning({ planId: assignments.planId });
  if (dropped.length > 0) {
    await tx
      .update(plans)
      .set({ version: nextVersion(plans) })
      .where(
        and(
          inArray(plans.id, [...new Set(dropped.map(({ planId }) => planId))]),
          eq(plans.status, 'draft'),
        ),
      );
  }
  await tx
    .delete(occurrences)
    .where(
      and(
        inArray(occurrences.id, ids),
        notExists(
          tx
            .select({ id: assignments.id })
            .from(assignments)
            .where(eq(assignments.occurrenceId, occurrences.id)),
        ),
      ),
    );
}
