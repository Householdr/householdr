import { inHousehold, plans, tasks } from '@householdr/db';
import { can, householdDate, occurrenceId, oneOffOccurrence, planWeek } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { allocateInto } from '../plans/allocate-into';
import { planningOf } from '../plans/planning';
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
 * names it (ADR-0018 §5, clarification). When its week has a plan already, a draft or published,
 * it is allocated into that plan on its own, without touching what is assigned there (ADR-0006
 * §3); otherwise the week's draft plans it. One that floats up to a deadline in a later week is
 * left to the drafts, which place it in a quiet week or the last one (ADR-0004 §4, clarification).
 */
export async function addOneOff(
  context: HouseholdContext,
  input: unknown,
): Promise<AddOneOffResult> {
  if (!can(context.member, { action: 'oneOff.add' })) return { ok: false, error: 'not-allowed' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<AddOneOffResult> => {
    // Locked, as drafting locks it, so a draft being made meanwhile sees it or allocates around it.
    const planning = await planningOf(tx, { lock: true });
    const { calendar } = planning;
    const now = context.clock.now();
    const today = householdDate(now, calendar.timeZone);
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
    const week = planWeek(date, calendar);
    const [plan] = await tx
      .select({
        id: plans.id,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
        status: plans.status,
      })
      .from(plans)
      .where(eq(plans.weekStart, week.start.toString()));
    const own = oneOffOccurrence(date, deadline, calendar);
    const withinWeek =
      Temporal.ZonedDateTime.compare(own.window.end, week.end.toZonedDateTime(calendar.timeZone)) <=
      0;
    if (plan && withinWeek) {
      await allocateInto(
        tx,
        { householdId, planning, plan, now },
        { id: occurrenceId(task.id, date), task: task.id, date, window: own.window },
        { id: task.id, duration },
      );
    }
    return { ok: true, taskId: task.id, name };
  });
}
