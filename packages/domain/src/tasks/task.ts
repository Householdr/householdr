import type { PlanTask } from '../plans/week-occurrences';
import type { WindowEdge } from '../schedules/occurrence';
import type { Interval } from '../schedules/since-last-done';

/**
 * How long one occurrence of a task takes, in whole minutes (ADR-0001 §5): at least a minute, and at
 * most a day. A chore that takes longer is several tasks, and the limit stops a slip of the keyboard
 * from swelling the household's average week, which floating tasks are placed by (ADR-0004 §4,
 * clarification).
 */
export const taskDuration = { min: 1, max: 24 * 60 } as const;

/** Whether `minutes` can be a task's duration: a whole number within `taskDuration`. */
export function isTaskDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= taskDuration.min && minutes <= taskDuration.max;
}

/**
 * The longest interval of a "since last done" task in each unit: a year, as for its first time
 * (ADR-0004 §8). A chore that comes round less often than that has a date of its own.
 */
export const taskInterval = { days: 365, weeks: 52, months: 12 } as const;

/** Whether `every` can be a "since last done" task's interval: a whole number from 1 up to a year. */
export function isTaskInterval(every: Interval): boolean {
  return (
    Number.isInteger(every.count) && every.count >= 1 && every.count <= taskInterval[every.unit]
  );
}

/**
 * The days a new task's schedule can start on, given `today` in the household's time zone: from
 * today up to a year from today, which anchors any of the simple frequencies (ADR-0004 §3).
 */
export function startRange(today: Temporal.PlainDate) {
  return { earliest: today, latest: today.add({ years: 1 }) };
}

/**
 * Whether a task's schedule can start on `day`, given `today` in the household's time zone: a day
 * within `startRange(today)`, or, when a task is changed, the day it starts on already (`kept`).
 * A task that has started keeps its first time, which has passed, but is never moved to another
 * day in the past, which no plan would ever reach (ADR-0004 §3).
 */
export function isStartDay(
  day: Temporal.PlainDate,
  today: Temporal.PlainDate,
  kept?: Temporal.PlainDate,
): boolean {
  if (kept?.equals(day)) return true;
  const { earliest, latest } = startRange(today);
  return (
    Temporal.PlainDate.compare(day, earliest) >= 0 && Temporal.PlainDate.compare(day, latest) <= 0
  );
}

/**
 * The days the form that changes a task offers for its first time: `startRange(today)`, stretched
 * to the day it starts on already (`kept`), so that keeping a day that has passed gets past the
 * browser's own check. The days between such a day and today stay refused (`isStartDay`).
 */
export function changedStartRange(today: Temporal.PlainDate, kept: Temporal.PlainDate) {
  const { earliest, latest } = startRange(today);
  return {
    earliest: Temporal.PlainDate.compare(kept, earliest) < 0 ? kept : earliest,
    latest: Temporal.PlainDate.compare(kept, latest) > 0 ? kept : latest,
  };
}

/**
 * Whether a one-off task due on `date` can have `deadline` as the last day it can be done on
 * (ADR-0004 §4), given `today` in the household's time zone: on or after its date, and within
 * `startRange(today)`, as its date is, so no one-off floats more than a year ahead; or, when a
 * one-off is changed, the deadline it has already (`kept`), which may have passed.
 */
export function isOneOffDeadline(
  deadline: Temporal.PlainDate,
  date: Temporal.PlainDate,
  today: Temporal.PlainDate,
  kept?: Temporal.PlainDate,
): boolean {
  if (kept?.equals(deadline)) return true;
  return Temporal.PlainDate.compare(deadline, date) >= 0 && isStartDay(deadline, today);
}

/**
 * The on-miss policy a task's form starts on, before whoever adds the task picks: roll over, since
 * a chore that still needs doing is the safer guess (ADR-0002 §2, clarification).
 */
export const defaultOnMiss: PlanTask['onMiss'] = 'roll over';

/**
 * How far a fixed window's edges may lie from the schedule date, in days either way, and how long
 * the window may last, in days (ADR-0004 §4, clarification).
 */
export const fixedWindow = { dayOffset: 3, days: 7 } as const;

/**
 * Whether a fixed task's window can run from `from` to `to` (ADR-0004 §4, clarification): each edge
 * a whole number of days from 3 before to 3 after the schedule date, and the window ending after it
 * starts and lasting at most 7 days, counted on the local clock.
 */
export function isFixedWindow(from: WindowEdge, to: WindowEdge): boolean {
  const edgeOk = ({ dayOffset }: WindowEdge) =>
    Number.isInteger(dayOffset) && Math.abs(dayOffset) <= fixedWindow.dayOffset;
  if (!edgeOk(from) || !edgeOk(to)) return false;
  const minutes = ({ dayOffset, time }: WindowEdge) =>
    dayOffset * 24 * 60 + time.hour * 60 + time.minute;
  const length = minutes(to) - minutes(from);
  return length > 0 && length <= fixedWindow.days * 24 * 60;
}
