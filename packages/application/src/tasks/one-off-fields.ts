import { isOneOffDeadline, isStartDay, isTaskDuration } from '@householdr/domain';
import * as v from 'valibot';
import { name } from '../households/name';
import { day, onMisses } from './task-fields';

/**
 * What a one-off task's form sends (CODE-12): its name, the minutes it takes, its date, from `today`
 * up to a year on, the last day it can be done on if any (`isOneOffDeadline`), and what happens if
 * it isn't done (ADR-0004 §4, ADR-0002 §2, clarification). A one-off being changed may keep the
 * date and deadline it has (`kept`). Every field is checked, whichever others are refused, so the
 * form can name them all.
 */
export function oneOffInput(
  today: Temporal.PlainDate,
  kept?: { date: Temporal.PlainDate; deadline?: Temporal.PlainDate },
) {
  return v.pipe(
    v.object({
      name,
      duration: v.pipe(v.number(), v.check(isTaskDuration)),
      date: v.pipe(
        day,
        v.check((date) => isStartDay(date, today, kept?.date)),
      ),
      deadline: v.optional(day),
      onMiss: v.picklist(onMisses),
    }),
    v.forward(
      v.partialCheck(
        [['date'], ['deadline']],
        ({ date, deadline }) =>
          deadline === undefined || isOneOffDeadline(deadline, date, today, kept?.deadline),
      ),
      ['deadline'],
    ),
  );
}

/** A field of the form that adds or changes a one-off task. */
export type OneOffField = 'name' | 'duration' | 'date' | 'deadline' | 'onMiss';

/** The fields in the order the form shows them, which its error summary follows. */
const order: OneOffField[] = ['name', 'duration', 'date', 'deadline', 'onMiss'];

/** The fields that `issues` are about, in the form's order. */
export function refusedOneOffFields(issues: readonly v.BaseIssue<unknown>[]): OneOffField[] {
  const keys = new Set(issues.map(({ path }) => path?.[0]?.key));
  return order.filter((field) => keys.has(field));
}
