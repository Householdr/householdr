import { households, inHousehold, schedules, tasks } from '@householdr/db';
import { can } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { storedRules } from './stored-schedule';
import { written } from './stored-task';
import { refusedFields, taskInput, type TaskField } from './task-fields';

type AddTaskResult =
  | { ok: true; taskId: string; name: string }
  /** Only heads change tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: TaskField[] };

/**
 * Adds a custom task (ADR-0001 §1, ADR-0007 §2 step 4), starting on the day given or today in the
 * household's time zone. On a simple frequency (ADR-0004 §3), it has a schedule of its own, whose
 * one rule starts on that day; it is flexible, or floating when it recurs monthly or less often
 * (§4), and rolls over or lapses when it isn't done, as chosen (ADR-0002 §2). Counted from when it
 * was last done, it is due on that day until it is first done (ADR-0004 §8).
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
    const sent = v.is(v.looseObject({ start: v.optional(v.undefined()) }), input)
      ? { ...input, start: today.toString() }
      : input;
    const parsed = v.safeParse(taskInput(today), sent);
    if (!parsed.success)
      return { ok: false, error: 'invalid', fields: refusedFields(parsed.issues) };
    const { name, duration } = parsed.output;
    const { rule, columns } = written(parsed.output);
    let scheduleId: string | null = null;
    if (rule) {
      const [schedule] = await tx
        .insert(schedules)
        .values({ householdId, rules: storedRules([rule]) })
        .returning({ id: schedules.id });
      if (!schedule) throw new Error('No schedule was written.');
      scheduleId = schedule.id;
    }
    const [task] = await tx
      .insert(tasks)
      .values({ householdId, name, duration, scheduleId, ...columns })
      .returning({ id: tasks.id });
    if (!task) throw new Error('No task was written.');
    return { ok: true, taskId: task.id, name };
  });
}
