import {
  assignments,
  nextVersion,
  occurrences,
  plans,
  schedules,
  tasks,
  type Transaction,
} from '@householdr/db';
import { and, eq, gt, inArray, notExists, or } from 'drizzle-orm';

// Removing a task, for the use cases that do (CODE-27): a head's, or a one-off by whoever may.

/**
 * Removes task `taskId`, whose row the transaction has claimed at the version its remover saw, and
 * which was on schedule `scheduleId` if any, on `today` in the household's time zone. It goes from
 * drafts and from plans whose week isn't over, where nobody did it yet. A task that has been in a
 * plan otherwise is hidden, not deleted: done work, past plans and the balances keep it by its name
 * (ADR-0001 §1, clarification). Any other goes, with its schedule unless another task uses it too
 * (ADR-0004 §1). The transaction must hold the household's planning lock (`planningOf`), so no
 * draft being made meanwhile plans the task again.
 */
export async function removeClaimed(
  tx: Transaction,
  taskId: string,
  scheduleId: string | null,
  today: Temporal.PlainDate,
) {
  await unplan(tx, taskId, today);
  const [kept] = await tx
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(eq(occurrences.taskId, taskId))
    .limit(1);
  if (kept) {
    await tx.update(tasks).set({ removed: true }).where(eq(tasks.id, taskId));
    return;
  }
  await tx.delete(tasks).where(eq(tasks.id, taskId));
  // A "since last done" task, or a one-off, has none (ADR-0004 §4, §8).
  if (scheduleId === null) return;
  await tx
    .delete(schedules)
    .where(
      and(
        eq(schedules.id, scheduleId),
        notExists(tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.scheduleId, scheduleId))),
      ),
    );
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
