import type { PlanTask } from '../plans/week-occurrences';

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
 * The on-miss policy a task's form starts on, before whoever adds the task picks: roll over, since
 * a chore that still needs doing is the safer guess (ADR-0002 §2, clarification).
 */
export const defaultOnMiss: PlanTask['onMiss'] = 'roll over';
