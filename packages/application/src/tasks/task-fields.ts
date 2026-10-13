import {
  fixedWindow,
  frequencies,
  isFixedWindow,
  isStartDay,
  isTaskDuration,
  isTaskInterval,
  type Frequency,
  type Interval,
  type PlanTask,
  type WindowEdge,
} from '@householdr/domain';
import * as v from 'valibot';
import { name } from '../households/name';

/** A day of the calendar as `YYYY-MM-DD`: one that exists, unlike 30 February. */
export const day = v.pipe(
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

/** How often a task is done: a simple frequency, or counted from when it was last done (ADR-0004 §3, §8). */
export const sinceLastDone = 'since-last-done';
export type Repeat = Frequency | typeof sinceLastDone;

const units: readonly Interval['unit'][] = ['days', 'weeks', 'months'];

/**
 * When a task on a schedule is done: any time in its plan week, or at set times around its date
 * (ADR-0004 §4, clarification).
 */
const whens = ['week', 'set'] as const;

/** A local time as `HH:MM`. */
const clockTime = v.pipe(
  v.string(),
  v.isoTime(),
  v.transform((time) => Temporal.PlainTime.from(time)),
);

/** A day of a window's edge, from 3 days before the date to 3 after. */
const edgeDay = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(-fixedWindow.dayOffset),
  v.maxValue(fixedWindow.dayOffset),
);

const repeats: readonly Repeat[] = [...frequencies, sinceLastDone];
export const onMisses: readonly PlanTask['onMiss'][] = ['roll over', 'lapse'];

/** A task as its form sends it, once valid. */
export type TaskInput = {
  name: string;
  duration: number;
  start: Temporal.PlainDate;
} & (
  | {
      frequency: Frequency;
      onMiss: PlanTask['onMiss'];
      /** At set times: the window around each date (ADR-0004 §4, clarification). */
      window?: { from: WindowEdge; to: WindowEdge };
    }
  | { frequency: typeof sinceLastDone; everyCount: number; everyUnit: Interval['unit'] }
);

/**
 * What a task's form sends (CODE-12): its name, the minutes it takes, how often, and the day it
 * starts on, from `today` up to a year on or, for a task being changed, the day it `kept`
 * (ADR-0004 §3). On a simple frequency, also what happens to an occurrence that isn't done
 * (ADR-0002 §2), and whether it is done any time that week or at set times, with its window
 * (`isFixedWindow`, §4); counted from when it was last done, how long after (§8), and it always
 * rolls over, any time that week.
 * Every field is checked, whichever others are refused, so the form can name them all.
 */
export function taskInput(today: Temporal.PlainDate, kept?: Temporal.PlainDate) {
  const counted = (input: { frequency: Repeat }) => input.frequency === sinceLastDone;
  return v.pipe(
    v.object({
      name,
      duration: v.pipe(v.number(), v.check(isTaskDuration)),
      frequency: v.picklist(repeats),
      everyCount: v.optional(v.pipe(v.number(), v.integer())),
      everyUnit: v.optional(v.picklist(units)),
      start: v.pipe(
        day,
        v.check((start) => isStartDay(start, today, kept)),
      ),
      onMiss: v.optional(v.picklist(onMisses)),
      when: v.optional(v.picklist(whens)),
      fromDay: v.optional(edgeDay),
      fromTime: v.optional(clockTime),
      toDay: v.optional(edgeDay),
      toTime: v.optional(clockTime),
    }),
    v.forward(
      v.partialCheck(
        [['frequency'], ['everyCount'], ['everyUnit']],
        (input) =>
          !counted(input) ||
          (input.everyCount !== undefined &&
            isTaskInterval({ count: input.everyCount, unit: input.everyUnit ?? 'days' })),
      ),
      ['everyCount'],
    ),
    v.forward(
      v.partialCheck(
        [['frequency'], ['everyUnit']],
        (input) => !counted(input) || input.everyUnit !== undefined,
      ),
      ['everyUnit'],
    ),
    v.forward(
      v.partialCheck(
        [['frequency'], ['onMiss']],
        (input) => counted(input) || input.onMiss !== undefined,
      ),
      ['onMiss'],
    ),
    // At set times, the window runs forward, within the limits (ADR-0004 §4, clarification).
    v.forward(
      v.partialCheck(
        [['frequency'], ['when'], ['fromDay'], ['fromTime'], ['toDay'], ['toTime']],
        (input) => {
          if (counted(input) || input.when !== 'set') return true;
          const { fromDay, fromTime, toDay, toTime } = input;
          if (fromDay === undefined || fromTime === undefined) return false;
          if (toDay === undefined || toTime === undefined) return false;
          return isFixedWindow(
            { dayOffset: fromDay, time: fromTime },
            { dayOffset: toDay, time: toTime },
          );
        },
      ),
      ['fromDay'],
    ),
    v.rawTransform(({ dataset, addIssue, NEVER }): TaskInput => {
      const { name, duration, frequency, everyCount, everyUnit, start, onMiss } = dataset.value;
      const { when, fromDay, fromTime, toDay, toTime } = dataset.value;
      const common = { name, duration, start };
      if (frequency === sinceLastDone && everyCount !== undefined && everyUnit !== undefined) {
        return { ...common, frequency, everyCount, everyUnit };
      }
      if (frequency !== sinceLastDone && onMiss !== undefined) {
        const set =
          when === 'set' &&
          fromDay !== undefined &&
          fromTime !== undefined &&
          toDay !== undefined &&
          toTime !== undefined;
        if (!set) return { ...common, frequency, onMiss };
        const window = {
          from: { dayOffset: fromDay, time: fromTime },
          to: { dayOffset: toDay, time: toTime },
        };
        return { ...common, frequency, onMiss, window };
      }
      // The checks above refuse anything else.
      addIssue();
      return NEVER;
    }),
  );
}

/** A field of the form that adds or changes a task. */
export type TaskField =
  | 'name'
  | 'duration'
  | 'frequency'
  | 'everyCount'
  | 'everyUnit'
  | 'start'
  | 'onMiss'
  | 'when'
  | 'window';

/** The fields in the order the form shows them, which its error summary follows. */
const order: TaskField[] = [
  'name',
  'duration',
  'frequency',
  'everyCount',
  'everyUnit',
  'start',
  'onMiss',
  'when',
  'window',
];

/** The fields of a fixed window, which the form names as one (ADR-0004 §4). */
const windowFields = new Set(['fromDay', 'fromTime', 'toDay', 'toTime']);

/** The fields that `issues` are about, in the form's order. */
export function refusedFields(issues: readonly v.BaseIssue<unknown>[]): TaskField[] {
  const keys = new Set(
    issues.map(({ path }) => {
      const key = path?.[0]?.key;
      return typeof key === 'string' && windowFields.has(key) ? 'window' : key;
    }),
  );
  return order.filter((field) => keys.has(field));
}

/** Which task a change is for: an id the household's tasks could have, or none of them. */
export const taskReference = v.looseObject({ taskId: v.pipe(v.string(), v.uuid()) });

/** The version of a task its form was loaded with (ADR-0019 §5). */
export const version = v.pipe(v.number(), v.integer(), v.minValue(1));
