import { schedules, tasks, type StoredRule } from '@householdr/db';
import {
  defaultTiming,
  frequencyOf,
  frequencyRule,
  type Interval,
  type PlanTask,
  type Rule,
} from '@householdr/domain';
import { scheduleOf } from './stored-schedule';
import { sinceLastDone, type Repeat, type TaskInput } from './task-fields';

/** The columns of a task and its schedule, if it has one, that say how often it is done. */
export const repeatColumns = {
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
}

/** How often the task of `row` is done, from the columns of `repeatColumns`. */
export function repeatOf(
  id: string,
  row: {
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
  return { frequency, start: rule.start, onMiss };
}

/**
 * What a task's valid input writes: its columns, and the one rule of its own schedule, unless it
 * is counted from when it was last done, which is flexible and always rolls over (ADR-0004 §3–§4,
 * §8).
 */
export function written(input: TaskInput): {
  rule: Rule | undefined;
  columns: Pick<
    typeof tasks.$inferInsert,
    'everyCount' | 'everyUnit' | 'start' | 'timing' | 'onMiss'
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
      },
    };
  }
  return {
    rule: frequencyRule(input.frequency, input.start),
    columns: {
      everyCount: null,
      everyUnit: null,
      start: null,
      timing: defaultTiming(input.frequency).kind,
      onMiss: input.onMiss,
    },
  };
}
