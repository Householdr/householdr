import { schedules, tasks, type StoredRule } from '@householdr/db';
import {
  defaultTiming,
  frequencyOf,
  frequencyRule,
  type Interval,
  type PlanTask,
  type Rule,
  type Timing,
  type WindowEdge,
} from '@householdr/domain';
import { scheduleOf } from './stored-schedule';
import { sinceLastDone, type Repeat, type TaskInput } from './task-fields';

/** The columns of a task that say when in its week it is done (ADR-0004 §4). */
export const timingColumns = {
  timing: tasks.timing,
  windowFromDay: tasks.windowFromDay,
  windowFromTime: tasks.windowFromTime,
  windowToDay: tasks.windowToDay,
  windowToTime: tasks.windowToTime,
};

/** A task's timing, from the columns of `timingColumns`: fixed with its window, or not. */
export function timingOf(
  id: string,
  row: {
    timing: Timing['kind'];
    windowFromDay: number | null;
    windowFromTime: string | null;
    windowToDay: number | null;
    windowToTime: string | null;
  },
): Timing {
  if (row.timing !== 'fixed') return { kind: row.timing };
  const { windowFromDay, windowFromTime, windowToDay, windowToTime } = row;
  if (windowFromDay === null || windowFromTime === null) {
    throw new Error(`Task ${id} is fixed without a window.`);
  }
  if (windowToDay === null || windowToTime === null) {
    throw new Error(`Task ${id} is fixed without a window.`);
  }
  return {
    kind: 'fixed',
    from: { dayOffset: windowFromDay, time: Temporal.PlainTime.from(windowFromTime) },
    to: { dayOffset: windowToDay, time: Temporal.PlainTime.from(windowToTime) },
  };
}

/** The columns of a task and its schedule, if it has one, that say how often it is done. */
export const repeatColumns = {
  ...timingColumns,
  onMiss: tasks.onMiss,
  everyCount: tasks.everyCount,
  everyUnit: tasks.everyUnit,
  start: tasks.start,
  rules: schedules.rules,
  extraDates: schedules.extraDates,
  exceptionDates: schedules.exceptionDates,
};

/** How often a task is done, as its form and its list show it (ADR-0004 §3, §8). */
export interface TaskRepeat {
  frequency: Repeat;
  /** For a "since last done" task. */
  every?: Interval;
  /** Its first time: the day its schedule's rule starts on, or when it is due if never done. */
  start: Temporal.PlainDate;
  /** What happens to an occurrence that isn't done (ADR-0002 §2). */
  onMiss: PlanTask['onMiss'];
  /** At set times: the window around each date (ADR-0004 §4, clarification). */
  window?: { from: WindowEdge; to: WindowEdge };
}

/** How often the task of `row` is done, from the columns of `repeatColumns`. */
export function repeatOf(
  id: string,
  row: Parameters<typeof timingOf>[1] & {
    onMiss: PlanTask['onMiss'];
    everyCount: number | null;
    everyUnit: Interval['unit'] | null;
    start: string | null;
    rules: StoredRule[] | null;
    extraDates: string[] | null;
    exceptionDates: string[] | null;
  },
): TaskRepeat {
  const { onMiss, everyCount, everyUnit, start, rules, extraDates, exceptionDates } = row;
  if (everyCount !== null && everyUnit !== null && start !== null) {
    return {
      frequency: sinceLastDone,
      every: { count: everyCount, unit: everyUnit },
      start: Temporal.PlainDate.from(start),
      onMiss,
    };
  }
  const schedule =
    rules && extraDates && exceptionDates && scheduleOf({ rules, extraDates, exceptionDates });
  const frequency = schedule && frequencyOf(schedule);
  const [rule] = schedule ? schedule.rules : [];
  // Only simple frequencies are written until the advanced editor comes (ADR-0004 §3).
  if (!frequency || !rule) throw new Error(`Task ${id} isn't on a simple frequency.`);
  const timing = timingOf(id, row);
  if (timing.kind !== 'fixed') return { frequency, start: rule.start, onMiss };
  return { frequency, start: rule.start, onMiss, window: { from: timing.from, to: timing.to } };
}

/**
 * What a task's valid input writes: its columns, and the one rule of its own schedule, unless it
 * is counted from when it was last done, which is flexible and always rolls over (ADR-0004 §3–§4,
 * §8). On a schedule, it is fixed with its window at set times, or as its frequency has it.
 */
export function written(input: TaskInput): {
  rule: Rule | undefined;
  columns: Pick<
    typeof tasks.$inferInsert,
    | 'everyCount'
    | 'everyUnit'
    | 'start'
    | 'timing'
    | 'onMiss'
    | 'windowFromDay'
    | 'windowFromTime'
    | 'windowToDay'
    | 'windowToTime'
  >;
} {
  if (input.frequency === sinceLastDone) {
    return {
      rule: undefined,
      columns: {
        everyCount: input.everyCount,
        everyUnit: input.everyUnit,
        start: input.start.toString(),
        timing: 'flexible',
        onMiss: 'roll over',
        ...noWindow,
      },
    };
  }
  return {
    rule: frequencyRule(input.frequency, input.start),
    columns: {
      everyCount: null,
      everyUnit: null,
      start: null,
      onMiss: input.onMiss,
      ...(input.window
        ? {
            timing: 'fixed',
            windowFromDay: input.window.from.dayOffset,
            windowFromTime: input.window.from.time.toString(),
            windowToDay: input.window.to.dayOffset,
            windowToTime: input.window.to.time.toString(),
          }
        : { timing: defaultTiming(input.frequency).kind, ...noWindow }),
    },
  };
}

/** The window columns of a task that isn't fixed. */
const noWindow = {
  windowFromDay: null,
  windowFromTime: null,
  windowToDay: null,
  windowToTime: null,
};
