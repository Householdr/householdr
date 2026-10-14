import { atVersion, households, inHousehold, nextVersion, tasks } from '@householdr/db';
import { can, householdDate } from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { oneOffInput, refusedOneOffFields, type OneOffField } from './one-off-fields';
import { readOneOff, type EditableOneOff } from './stored-one-off';
import { taskReference, version } from './task-fields';

type EditOneOffResult =
  | { ok: true }
  /**
   * Only the member who added it changes a one-off, until it is done; heads change any, once signed
   * in with two factors (ADR-0006 §3, clarification).
   */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such one-off task, or no longer. */
  | { ok: false; error: 'not-found' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: OneOffField[] }
  /** Someone changed it since the form was loaded, so nothing was saved: the task now (ADR-0019 §5). */
  | { ok: false; error: 'conflict'; current: EditableOneOff };

/**
 * Changes a one-off task's name, duration, date, deadline or on-miss policy (ADR-0004 §4), by the
 * member who added it while it isn't done, or by a head (ADR-0006 §3, clarification), from the
 * version they saw (ADR-0019 §5). It keeps a date or deadline that has passed, or moves to one from
 * today on, as a task's first time does (`isStartDay`). Changing it isn't logged. Saved unchanged, it keeps
 * its version. Drafts plan it as it is from their next run; a published plan is frozen (ADR-0006
 * §3).
 */
export async function editOneOff(
  context: HouseholdContext,
  input: unknown,
): Promise<EditOneOffResult> {
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const { taskId } = target.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<EditOneOffResult> => {
    const conflict = async (): Promise<EditOneOffResult> => {
      const now = await readOneOff(tx, taskId);
      return now
        ? { ok: false, error: 'conflict', current: now.oneOff }
        : { ok: false, error: 'not-found' };
    };
    const found = await readOneOff(tx, taskId);
    if (!found) return { ok: false, error: 'not-found' };
    const { oneOff: current, addedBy, done } = found;
    if (!can(context.member, { action: 'oneOff.edit', addedBy, done })) {
      return { ok: false, error: 'not-allowed' };
    }
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = householdDate(context.clock.now(), household.timeZone);
    const parsed = v.safeParse(oneOffInput(today, current), input);
    const seen = v.safeParse(v.looseObject({ version }), input);
    if (!parsed.success || !seen.success) {
      // A form loaded before someone else's change hears of that change first.
      if (seen.success && seen.output.version !== current.version) return conflict();
      return {
        ok: false,
        error: 'invalid',
        fields: parsed.success ? [] : refusedOneOffFields(parsed.issues),
      };
    }
    const next = parsed.output;
    const sameDeadline =
      next.deadline === undefined
        ? current.deadline === undefined
        : current.deadline !== undefined && next.deadline.equals(current.deadline);
    const changed =
      next.name !== current.name ||
      next.duration !== current.duration ||
      !next.date.equals(current.date) ||
      !sameDeadline ||
      next.onMiss !== current.onMiss;
    // Nothing to write, so it keeps its version, even when the form's is older.
    if (!changed) return { ok: true };
    const [saved] = await tx
      .update(tasks)
      .set({
        name: next.name,
        duration: next.duration,
        once: next.date.toString(),
        deadline: next.deadline?.toString() ?? null,
        onMiss: next.onMiss,
        version: nextVersion(tasks),
      })
      .where(and(atVersion(tasks, taskId, seen.output.version), eq(tasks.removed, false)))
      .returning({ id: tasks.id });
    return saved ? { ok: true } : conflict();
  });
}
