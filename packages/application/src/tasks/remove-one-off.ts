import { atVersion, inHousehold, nextVersion, tasks } from '@householdr/db';
import { can, householdDate } from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from '../plans/planning';
import { removeClaimed } from './removal';
import { logOneOff, readOneOff, type EditableOneOff } from './stored-one-off';
import { taskReference, version } from './task-fields';

type RemoveOneOffResult =
  | { ok: true }
  /**
   * Only the member who added it removes a one-off, until it is done; heads remove any, once signed
   * in with two factors (ADR-0006 §3, clarification).
   */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such one-off task, or no longer. */
  | { ok: false; error: 'not-found' }
  /** No version the task could have had, as only a tampered form sends. */
  | { ok: false; error: 'invalid' }
  /** Someone changed it since the confirmation was loaded, so it wasn't removed: the task now. */
  | { ok: false; error: 'conflict'; current: EditableOneOff };

/**
 * Removes a one-off task, by the member who added it while it isn't done, or by a head (ADR-0006
 * §3, clarification), as they saw it when they confirmed (ADR-0019 §5). As any task: one that has
 * been planned is hidden, its history kept (ADR-0001 §1, clarification), and any other goes (see
 * `removeClaimed`). The activity log names it (ADR-0018 §5, clarification).
 */
export async function removeOneOff(
  context: HouseholdContext,
  input: unknown,
): Promise<RemoveOneOffResult> {
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const seen = v.safeParse(v.looseObject({ version }), input);
  const { taskId } = target.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<RemoveOneOffResult> => {
    // Locked, as drafting locks it, so no draft being made meanwhile plans it again.
    const { calendar } = await planningOf(tx, { lock: true });
    const found = await readOneOff(tx, taskId);
    if (!found) return { ok: false, error: 'not-found' };
    const { oneOff: current, addedBy, done } = found;
    if (!can(context.member, { action: 'oneOff.edit', addedBy, done })) {
      return { ok: false, error: 'not-allowed' };
    }
    if (!seen.success) return { ok: false, error: 'invalid' };
    const [claimed] = await tx
      .update(tasks)
      .set({ version: nextVersion(tasks) })
      .where(and(atVersion(tasks, taskId, seen.output.version), eq(tasks.removed, false)))
      .returning({ name: tasks.name });
    if (!claimed) return { ok: false, error: 'conflict', current };
    await removeClaimed(tx, taskId, null, householdDate(context.clock.now(), calendar.timeZone));
    await logOneOff(tx, context, 'one-off.removed', claimed.name);
    return { ok: true };
  });
}
