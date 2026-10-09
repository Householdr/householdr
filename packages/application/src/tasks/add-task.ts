import { households, inHousehold, schedules, tasks } from '@householdr/db';
import { can, defaultTiming, frequencyRule } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { storedRules } from './stored-schedule';
import { refusedFields, taskFields, type TaskField } from './task-fields';

type AddTaskResult =
  | { ok: true; taskId: string; name: string }
  /** Only heads change tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: TaskField[] };

/**
 * Adds a custom task on a simple frequency (ADR-0001 §1, ADR-0004 §3, ADR-0007 §2 step 4): on a
 * schedule of its own, whose one rule starts on the day given or today in the household's time
 * zone; flexible, or floating when it recurs monthly or less often (ADR-0004 §4); rolling over or
 * lapsing when it isn't done, as chosen (ADR-0002 §2).
 */
export async function addTask(context: HouseholdContext, input: unknown): Promise<AddTaskResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<AddTaskResult> => {
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    // Without a day, it starts today.
    const fields = taskFields(today);
    const parsed = v.safeParse(v.object({ ...fields, start: v.optional(fields.start) }), input);
    if (!parsed.success)
      return { ok: false, error: 'invalid', fields: refusedFields(parsed.issues) };
    const { duration, frequency, start = today, onMiss } = parsed.output;
    const [schedule] = await tx
      .insert(schedules)
      .values({ householdId, rules: storedRules([frequencyRule(frequency, start)]) })
      .returning({ id: schedules.id });
    if (!schedule) throw new Error('No schedule was written.');
    const [task] = await tx
      .insert(tasks)
      .values({
        householdId,
        name: parsed.output.name,
        duration,
        scheduleId: schedule.id,
        timing: defaultTiming(frequency).kind,
        onMiss,
      })
      .returning({ id: tasks.id });
    if (!task) throw new Error('No task was written.');
    return { ok: true, taskId: task.id, name: parsed.output.name };
  });
}
