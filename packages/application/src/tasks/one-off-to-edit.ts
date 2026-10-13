import { households, inHousehold } from '@householdr/db';
import { can, changedStartRange, householdDate } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { readOneOff, type EditableOneOff } from './stored-one-off';
import { taskReference } from './task-fields';

type OneOffToEditResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      oneOff: EditableOneOff;
      /** The days its date picker offers (`changedStartRange`), from today and its own date. */
      dates: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
    }
  /**
   * Only the member who added it changes a one-off, until it is done; heads change any, once signed
   * in with two factors (ADR-0006 §3, clarification).
   */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such one-off task, or no longer. */
  | { ok: false; error: 'not-found' };

/** A one-off task of the household, for the member who may change or remove it (ADR-0006 §3). */
export async function oneOffToEdit(
  context: HouseholdContext,
  input: unknown,
): Promise<OneOffToEditResult> {
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<OneOffToEditResult> => {
    const found = await readOneOff(tx, target.output.taskId);
    if (!found) return { ok: false, error: 'not-found' };
    const { oneOff, addedBy, done } = found;
    if (!can(context.member, { action: 'oneOff.edit', addedBy, done })) {
      return { ok: false, error: 'not-allowed' };
    }
    const [household] = await tx
      .select({ name: households.name, timeZone: households.timeZone })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = householdDate(context.clock.now(), household.timeZone);
    return {
      ok: true,
      household: household.name,
      oneOff,
      dates: changedStartRange(today, oneOff.date),
    };
  });
}
