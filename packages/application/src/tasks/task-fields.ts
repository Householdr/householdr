import {
  advancedSchedule,
  fixedWindow,
  frequencies,
  isAdvancedSchedule,
  isScheduleDate,
  isFixedWindow,
  isStartDay,
  isTaskDuration,
  isTaskInterval,
  weekdays,
  weekdaysOfMonth,
  type AdvancedSchedule,
  type Frequency,
  type Interval,
  type PlanTask,
  type Schedule,
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

/**
 * How often a task is done: a simple frequency, an advanced schedule, the dates of another task's
 * schedule, or counted from when it was last done (ADR-0004 §1, §3, §8).
 */
export const sinceLastDone = 'since-last-done';
export const advanced = 'advanced';
export const shared = 'shared';
export type Repeat = Frequency | typeof advanced | typeof shared | typeof sinceLastDone;

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

/** How many weeks or months apart a rule's dates are; its limits are the schedule's to check. */
const every = v.pipe(v.number(), v.integer());

/**
 * A rule of the advanced editor (ADR-0004 §3, clarifications), its limits checked with the whole
 * schedule.
 */
const advancedRuleInput = v.variant('kind', [
  v.object({
    kind: v.literal('weeks'),
    every,
    days: v.array(v.picklist(weekdays)),
    start: day,
  }),
  v.object({ kind: v.literal('months'), every, start: day }),
  v.object({
    kind: v.literal('weekdays-of-month'),
    every,
    which: v.array(v.picklist(weekdaysOfMonth)),
    day: v.picklist(weekdays),
    start: day,
  }),
  v.object({ kind: v.literal('year'), start: day }),
]);

const repeats: readonly Repeat[] = [...frequencies, advanced, shared, sinceLastDone];
export const onMisses: readonly PlanTask['onMiss'][] = ['roll over', 'lapse'];

/** A task as its form sends it, once valid. */
export type TaskInput = {
  name: string;
  duration: number;
} & (
  | {
      frequency: Frequency;
      start: Temporal.PlainDate;
      onMiss: PlanTask['onMiss'];
      /** At set times: the window around each date (ADR-0004 §4, clarification). */
      window?: { from: WindowEdge; to: WindowEdge };
      /** For a task that shares its schedule: new dates for it alone (ADR-0004 §1, clarification). */
      ownDates: boolean;
    }
  | {
      frequency: typeof advanced;
      schedule: AdvancedSchedule;
      onMiss: PlanTask['onMiss'];
      window?: { from: WindowEdge; to: WindowEdge };
      ownDates: boolean;
    }
  | {
      frequency: typeof shared;
      /** The task whose schedule it shares (ADR-0004 §1, clarification). */
      sharedWith: string;
      onMiss: PlanTask['onMiss'];
      window?: { from: WindowEdge; to: WindowEdge };
    }
  | {
      frequency: typeof sinceLastDone;
      start: Temporal.PlainDate;
      everyCount: number;
      everyUnit: Interval['unit'];
    }
);

/** What a task being changed has already, which stays allowed even once it has passed. */
export interface KeptDays {
  /** Its first time. */
  start: Temporal.PlainDate;
  /** Its schedule, whose rules' first times and dates stay allowed (ADR-0004 §3, clarification). */
  schedule?: Schedule;
}

/**
 * What a task's form sends (CODE-12): its name, the minutes it takes, how often, and the day it
 * starts on, from `today` up to a year on or, for a task being changed, the day it `kept`
 * (ADR-0004 §3). On a simple frequency, also what happens to an occurrence that isn't done
 * (ADR-0002 §2), and whether it is done any time that week or at set times, with its window
 * (`isFixedWindow`, §4); counted from when it was last done, how long after (§8), and it always
 * rolls over, any time that week. On an advanced schedule, its rules, each with its own first time
 * instead of the task's, and its extra and exception dates (`isAdvancedSchedule`,
 * `isScheduleDate`, §3), with the on-miss policy and timing of a simple frequency. Sharing another
 * task's schedule, which task, with them too (§1, clarification); the task is the use case's to
 * find. A task that shares its schedule may take new dates for itself alone (`ownDates`).
 * Every field is checked, whichever others are refused, so the form can name them all.
 */
export function taskInput(today: Temporal.PlainDate, kept?: KeptDays) {
  const counted = (input: { frequency: Repeat }) => input.frequency === sinceLastDone;
  const custom = (input: { frequency: Repeat }) => input.frequency === advanced;
  const keptStarts = [kept?.start, ...(kept?.schedule?.rules.map((rule) => rule.start) ?? [])];
  const keptDates = [
    ...(kept?.schedule?.extraDates ?? []),
    ...(kept?.schedule?.exceptionDates ?? []),
  ];
  const ruleStart = (start: Temporal.PlainDate) =>
    keptStarts.some((day) => day?.equals(start)) || isStartDay(start, today);
  // Up to 50, each once, from today up to two years on unless the schedule has it already.
  const dates = v.pipe(
    v.array(day),
    v.maxLength(advancedSchedule.dates),
    v.check((list) => new Set(list.map(String)).size === list.length),
    v.check((list) => list.every((date) => isScheduleDate(date, today, keptDates))),
  );
  return v.pipe(
    v.object({
      name,
      duration: v.pipe(v.number(), v.check(isTaskDuration)),
      frequency: v.picklist(repeats),
      everyCount: v.optional(v.pipe(v.number(), v.integer())),
      everyUnit: v.optional(v.picklist(units)),
      start: v.optional(
        v.pipe(
          day,
          v.check((start) => isStartDay(start, today, kept?.start)),
        ),
      ),
      rules: v.optional(
        v.pipe(
          v.array(advancedRuleInput),
          v.check((rules) => rules.every((rule) => ruleStart(rule.start))),
        ),
      ),
      extraDates: v.optional(dates),
      exceptionDates: v.optional(dates),
      sharedWith: v.optional(v.pipe(v.string(), v.uuid())),
      ownDates: v.optional(v.boolean()),
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
    // A simple frequency and "since last done" start on a day; an advanced schedule's rules do,
    // and a shared schedule's are another task's.
    v.forward(
      v.partialCheck(
        [['frequency'], ['start']],
        (input) => custom(input) || input.frequency === shared || input.start !== undefined,
      ),
      ['start'],
    ),
    v.forward(
      v.partialCheck(
        [['frequency'], ['sharedWith']],
        (input) => input.frequency !== shared || input.sharedWith !== undefined,
      ),
      ['sharedWith'],
    ),
    v.forward(
      v.partialCheck(
        [['frequency'], ['rules'], ['extraDates'], ['exceptionDates']],
        (input) =>
          !custom(input) ||
          // The dates are checked on their own above: here only whether there is one counts.
          isAdvancedSchedule({
            rules: input.rules ?? [],
            extraDates: input.extraDates?.slice(0, 1) ?? [],
            exceptionDates: [],
          }),
      ),
      ['rules'],
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
      const { rules, extraDates, exceptionDates, sharedWith, ownDates = false } = dataset.value;
      const { when, fromDay, fromTime, toDay, toTime } = dataset.value;
      const common = { name, duration };
      if (frequency === sinceLastDone && everyCount !== undefined && everyUnit !== undefined) {
        if (start) return { ...common, frequency, start, everyCount, everyUnit };
      }
      if (frequency !== sinceLastDone && onMiss !== undefined) {
        const set =
          when === 'set' &&
          fromDay !== undefined &&
          fromTime !== undefined &&
          toDay !== undefined &&
          toTime !== undefined;
        const window = set
          ? { from: { dayOffset: fromDay, time: fromTime }, to: { dayOffset: toDay, time: toTime } }
          : undefined;
        const timed = { ...common, onMiss, ...(window && { window }) };
        if (frequency === shared) {
          if (sharedWith) return { ...timed, frequency, sharedWith };
        } else if (frequency === advanced) {
          const schedule = {
            rules: rules ?? [],
            extraDates: extraDates ?? [],
            exceptionDates: exceptionDates ?? [],
          };
          return { ...timed, frequency, schedule, ownDates };
        } else if (start) {
          return { ...timed, frequency, start, ownDates };
        }
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
  | 'sharedWith'
  | 'everyCount'
  | 'everyUnit'
  | 'start'
  | 'onMiss'
  | 'when'
  | 'window'
  | 'rules'
  | 'extraDates'
  | 'exceptionDates';

/** The fields in the order the form shows them, which its error summary follows. */
const order: TaskField[] = [
  'name',
  'duration',
  'frequency',
  'sharedWith',
  'everyCount',
  'everyUnit',
  'start',
  'rules',
  'extraDates',
  'exceptionDates',
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
