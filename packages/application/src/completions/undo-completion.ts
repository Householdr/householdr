import { activityLog, completions, inHousehold, occurrences, plans } from '@householdr/db';
import { can } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/context';
import { creditedMembers, inPlanWeek, thisPlanWeek } from './completion-week';

/** What undoing sends (CODE-12): the completion, as the member saw it. */
const undoInput = v.object({ completion: v.pipe(v.string(), v.uuid()) });

type UndoCompletionResult =
  | { ok: true }
  /** Not a completion's id. */
  | { ok: false; error: 'invalid' }
  /** No such completion: undone already, or never made. */
  | { ok: false; error: 'not-found' }
  /** Only whoever logged it, a member it credits, or a head undoes it (ADR-0006 §4). */
  | { ok: false; error: 'not-allowed' }
  /** Its plan week is over: a correction is a head's ledger entry then (ADR-0006 §4). */
  | { ok: false; error: 'week-over' };

/**
 * Undoes a completion within its plan week (ADR-0006 §4, clarification): by whoever logged it, a
 * member it credits, or a head. Its occurrence is open again, and nobody is credited for it.
 * Undoing a completion that credits others is written to the activity log, once per member it
 * credited besides whoever undoes it (ADR-0018 §5).
 */
export async function undoCompletion(
  context: HouseholdContext,
  input: unknown,
): Promise<UndoCompletionResult> {
  const parsed = v.safeParse(undoInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const actor = context.member;
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<UndoCompletionResult> => {
    const [found] = await tx
      .select({ occurrenceId: completions.occurrenceId })
      .from(completions)
      .where(eq(completions.id, parsed.output.completion));
    if (!found) return { ok: false, error: 'not-found' };
    // The occurrence first, as completing locks it, so an undo and a tap wait for each other.
    await tx
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(eq(occurrences.id, found.occurrenceId))
      .for('update');
    const [completion] = await tx
      .select({
        loggedBy: completions.loggedBy,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
      })
      .from(completions)
      .innerJoin(plans, eq(plans.id, completions.planId))
      .where(eq(completions.id, parsed.output.completion));
    if (!completion) return { ok: false, error: 'not-found' };
    const credited = (await creditedMembers(tx, parsed.output.completion)).map((m) => m.id);
    const { loggedBy } = completion;
    const may = (inWeek: boolean) =>
      can(actor, { action: 'completion.undo', loggedBy, credited, inPlanWeek: inWeek });
    if (!may(true)) return { ok: false, error: 'not-allowed' };
    const { today } = await thisPlanWeek(tx, context.clock.now());
    if (!may(inPlanWeek(completion, today))) return { ok: false, error: 'week-over' };

    await tx.delete(completions).where(eq(completions.id, parsed.output.completion));
    await tx
      .update(occurrences)
      .set({ status: 'open' })
      .where(eq(occurrences.id, found.occurrenceId));
    const others = credited.filter((member) => member !== actor.id);
    if (others.length > 0) {
      const at = new Date(context.clock.now().epochMilliseconds);
      await tx.insert(activityLog).values(
        others.map((subjectId) => ({
          householdId,
          at,
          actorId: actor.id,
          action: 'completion.undone' as const,
          subjectId,
        })),
      );
    }
    return { ok: true };
  });
}
