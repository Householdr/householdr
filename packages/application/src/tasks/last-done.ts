import { completions, occurrences, type Transaction } from '@householdr/db';
import { householdDate } from '@householdr/domain';
import { eq, max } from 'drizzle-orm';

/**
 * The day each task was last done on, in `timeZone`, by its latest completion: any completion of
 * it resets a "since last done" clock (ADR-0004 §8).
 */
export async function lastDoneOf(tx: Transaction, timeZone: string) {
  const rows = await tx
    .select({ taskId: occurrences.taskId, at: max(completions.at) })
    .from(completions)
    .innerJoin(occurrences, eq(occurrences.id, completions.occurrenceId))
    .groupBy(occurrences.taskId);
  const days = new Map<string, Temporal.PlainDate>();
  for (const { taskId, at } of rows) {
    if (at) {
      days.set(
        taskId,
        householdDate(Temporal.Instant.fromEpochMilliseconds(at.getTime()), timeZone),
      );
    }
  }
  return days;
}
