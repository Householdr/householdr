import { schedules, tasks, type StoredRule } from '@householdr/db';
import {
  advancedScheduleOf,
  defaultTiming,
  frequencyOf,
  frequencyRule,
  scheduleOfAdvanced,
  type AdvancedSchedule,
  type Interval,
  type PlanTask,
  type Schedule,
  type Timing,
  type WindowEdge,
} from '@householdr/domain';
import { scheduleOf } from './stored-schedule';
import { advanced, sinceLastDone, type Repeat, type TaskInput } from './task-fields';

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
  /** For a task on an advanced schedule: its rules and dates (ADR-0004 §3). */
  schedule?: AdvancedSchedule;
  /**
   * Its first time: the day its schedule's rule starts on, or when it is due if never done. On an
   * advanced schedule, the earliest first time of its rules and extra dates.
   */
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
  if (!schedule) throw new Error(`Task ${id} has neither a schedule nor an interval.`);
  const timing = timingOf(id, row);
  const window = timing.kind === 'fixed' ? { from: timing.from, to: timing.to } : undefined;
  const timed = { onMiss, ...(window && { window }) };
  const frequency = frequencyOf(schedule);
  const [rule] = schedule.rules;
  if (frequency && rule) return { frequency, start: rule.start, ...timed };
  // Anything else the editor writes is an advanced schedule (ADR-0004 §3).
  const built = advancedScheduleOf(schedule);
  if (!built) throw new Error(`Task ${id} has a schedule the editor can't show.`);
  const firsts = [...built.rules.map((r) => r.start), ...built.extraDates];
  const [first] = firsts.toSorted((a, b) => Temporal.PlainDate.compare(a, b));
  if (!first) throw new Error(`Task ${id} has a schedule without dates.`);
  return { frequency: advanced, schedule: built, start: first, ...timed };
}

/**
 * What a task's valid input writes: its columns, and its own schedule: the one rule of a simple
 * frequency, or what the advanced editor built, unless it is counted from when it was last done,
 * which is flexible and always rolls over (ADR-0004 §3–§4, §8). On a schedule, it is fixed with its
 * window at set times, or as its frequency has it; an advanced one any time that week is flexible
 * (§3, clarification).
 */
export function written(input: TaskInput): {
  schedule: Schedule | undefined;
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
      schedule: undefined,
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
  const custom = input.frequency === advanced;
  return {
    schedule: custom
      ? scheduleOfAdvanced(input.schedule)
      : {
          rules: [frequencyRule(input.frequency, input.start)],
          extraDates: [],
          exceptionDates: [],
        },
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
        : {
            timing: custom ? 'flexible' : defaultTiming(input.frequency).kind,
            ...noWindow,
          }),
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
