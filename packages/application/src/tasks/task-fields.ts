import { frequencies, isStartDay, isTaskDuration } from '@householdr/domain';
import * as v from 'valibot';
import { name } from '../households/name';

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
 * What a task's form sends (CODE-12): its name, the minutes it takes, a simple frequency, the day
 * it starts on, from `today` up to a year on or, for a task being changed, the day it `kept`
 * (ADR-0004 §3), and what happens to an occurrence that isn't done (ADR-0002 §2).
 */
export const taskFields = (today: Temporal.PlainDate, kept?: Temporal.PlainDate) => ({
  name,
  duration: v.pipe(v.number(), v.check(isTaskDuration)),
  frequency: v.picklist(frequencies),
  start: v.pipe(
    day,
    v.check((start) => isStartDay(start, today, kept)),
  ),
  onMiss: v.picklist(['roll over', 'lapse']),
});

/** A field of the form that adds or changes a task. */
export type TaskField = keyof ReturnType<typeof taskFields>;

/** The fields in the order the form shows them, which its error summary follows. */
const order: TaskField[] = ['name', 'duration', 'frequency', 'start', 'onMiss'];

/** The fields that `issues` are about, in the form's order. */
export function refusedFields(issues: readonly v.BaseIssue<unknown>[]): TaskField[] {
  const keys = new Set(issues.map(({ path }) => path?.[0]?.key));
  return order.filter((field) => keys.has(field));
}

/** Which task a change is for: an id the household's tasks could have, or none of them. */
export const taskReference = v.looseObject({ taskId: v.pipe(v.string(), v.uuid()) });

/** The version of a task its form was loaded with (ADR-0019 §5). */
export const version = v.pipe(v.number(), v.integer(), v.minValue(1));
