import { households, inHousehold, tasks } from '@householdr/db';
import { can, householdDate } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { oneOffInput, refusedOneOffFields, type OneOffField } from './one-off-fields';
import { logOneOff } from './stored-one-off';

type AddOneOffResult =
  | { ok: true; taskId: string; name: string }
  /** A profile without an account never acts for itself (ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: OneOffField[] };

/**
 * Adds a one-off task (ADR-0004 §4), by any member with an account, children included (ADR-0006
 * §3, clarification): on its one date, flexible within that date's week, or up to its deadline if
 * it has one, rolling over or lapsing as chosen (ADR-0002 §2, clarification). The activity log
 * names it (ADR-0018 §5, clarification). The next draft of its week plans it.
 */
export async function addOneOff(
  context: HouseholdContext,
  input: unknown,
): Promise<AddOneOffResult> {
  if (!can(context.member, { action: 'oneOff.add' })) return { ok: false, error: 'not-allowed' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<AddOneOffResult> => {
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = householdDate(context.clock.now(), household.timeZone);
    const parsed = v.safeParse(oneOffInput(today), input);
    if (!parsed.success) {
      return { ok: false, error: 'invalid', fields: refusedOneOffFields(parsed.issues) };
    }
    const { name, duration, date, deadline, onMiss } = parsed.output;
    const [task] = await tx
      .insert(tasks)
      .values({
        householdId,
        name,
        duration,
        once: date.toString(),
        deadline: deadline?.toString(),
        addedBy: context.member.id,
        timing: 'flexible',
        onMiss,
      })
      .returning({ id: tasks.id });
    if (!task) throw new Error('No task was written.');
    await logOneOff(tx, context, 'one-off.added', name);
    return { ok: true, taskId: task.id, name };
  });
}
