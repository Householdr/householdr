import { inHousehold, occurrences, plans, type Transaction } from '@householdr/db';
import { weekHasBegun } from '@householdr/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { planningOf, type PlanContext } from './planning';

/**
 * The household's open occurrences due to close as missed at `now`: those a plan no longer carries
 * over, once that plan's week has begun (ADR-0002 §2, clarifications). Until then they are open,
 * their own week's work (ADR-0006 §4).
 */
export async function dueToClose(tx: Transaction, now: Temporal.Instant, timeZone: string) {
  const marked = await tx
    .select({ id: occurrences.id, weekStart: plans.weekStart })
    .from(occurrences)
    .innerJoin(plans, eq(plans.id, occurrences.closedByPlan))
    .where(eq(occurrences.status, 'open'));
  return marked
    .filter((row) => weekHasBegun(Temporal.PlainDate.from(row.weekStart), now, timeZone))
    .map((row) => row.id);
}

/** Closes as missed the household's occurrences due to close at `now`. */
export async function closeDue(tx: Transaction, now: Temporal.Instant, timeZone: string) {
  const due = await dueToClose(tx, now, timeZone);
  if (due.length > 0) {
    await tx
      .update(occurrences)
      .set({ status: 'missed' })
      .where(and(inArray(occurrences.id, due), eq(occurrences.status, 'open')));
  }
  return due.length;
}

type CloseDueOccurrencesResult = { ok: true; closed: number } | { ok: false; error: 'not-allowed' };

/**
 * Closes as missed what is due to close now (ADR-0002 §2, clarifications): the occurrences nobody
 * did that a plan whose week has begun doesn't carry over, as the scheduler does at the start of
 * each plan week. Closing twice changes nothing (CODE-19).
 */
export async function closeDueOccurrences(
  context: PlanContext,
): Promise<CloseDueOccurrencesResult> {
  if (context.member !== 'scheduler') return { ok: false, error: 'not-allowed' };
  return inHousehold(context.db, context.householdId, async (tx) => {
    // Locked, as drafting locks it, so a draft never reads a pool half closed.
    const { calendar } = await planningOf(tx, { lock: true });
    return {
      ok: true as const,
      closed: await closeDue(tx, context.clock.now(), calendar.timeZone),
    };
  });
}
