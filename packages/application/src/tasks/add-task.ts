import { households, inHousehold, schedules, tasks } from '@householdr/db';
import {
  can,
  defaultTiming,
  frequencies,
  frequencyRule,
  isTaskDuration,
  startRange,
} from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { name } from '../households/name';
import { storedRules } from './stored-schedule';

/** A day of the calendar as `YYYY-MM-DD`: one that exists, unlike 30 February. */
const day = v.pipe(
  v.string(),
  v.isoDate(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try {
      return Temporal.PlainDate.from(dataset.value);
    } catch {
      // The format allows up to 31 days in any month.
      addIssue();
      return NEVER;
    }
  }),
);

/**
 * What adding a task sends (CODE-12): its name, the minutes it takes, a simple frequency, the day
 * it starts on, from `today` up to a year on (ADR-0004 §3), or today without one, and what happens
 * to an occurrence that isn't done (ADR-0002 §2).
 */
const fields = (today: Temporal.PlainDate) => {
  const { earliest, latest } = startRange(today);
  const within = (start: Temporal.PlainDate) =>
    Temporal.PlainDate.compare(start, earliest) >= 0 &&
    Temporal.PlainDate.compare(start, latest) <= 0;
  return {
    name,
    duration: v.pipe(v.number(), v.check(isTaskDuration)),
    frequency: v.picklist(frequencies),
    start: v.optional(v.pipe(day, v.check(within))),
    onMiss: v.picklist(['roll over', 'lapse']),
  };
};

/** A field of the form that adds a task. */
export type NewTaskField = keyof ReturnType<typeof fields>;

/** The fields in the order the form shows them, which its error summary follows. */
const order: NewTaskField[] = ['name', 'duration', 'frequency', 'start', 'onMiss'];

type AddTaskResult =
  | { ok: true; taskId: string; name: string }
  /** Only heads change tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: NewTaskField[] };

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
    const parsed = v.safeParse(v.object(fields(today)), input);
    if (!parsed.success) {
      const keys = new Set(parsed.issues.map(({ path }) => path?.[0]?.key));
      return { ok: false, error: 'invalid', fields: order.filter((field) => keys.has(field)) };
    }
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
