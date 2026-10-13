import type { OneOffField, Repeat, TaskField } from '@householdr/application';
import {
  taskDuration,
  type Dueness,
  type Frequency,
  type Interval,
  type PlanTask,
} from '@householdr/domain';
import { m } from '#lib/paraglide/messages.js';
import { scheduleWords } from '#lib/schedule-words.js';
import type { ScheduleData } from '#lib/task-schedule.js';

/** A frequency in words, never as its rule (ADR-0004 §3). */
const frequencyWords: Record<Frequency, () => string> = {
  daily: m['tasks.daily'],
  weekly: m['tasks.weekly'],
  biweekly: m['tasks.biweekly'],
  monthly: m['tasks.monthly'],
  'tri-monthly': m['tasks.tri-monthly'],
  yearly: m['tasks.yearly'],
};

/**
 * The choices of how often a task is done, in words: the frequencies, an advanced schedule, then
 * "since last done".
 */
export const repeatWords: Record<Repeat, () => string> = {
  ...frequencyWords,
  advanced: m['tasks.advanced'],
  shared: m['tasks.shared'],
  'since-last-done': m['tasks.since-last-done'],
};

/** The units of a "since last done" task's interval, in words (ADR-0004 §8). */
export const unitWords: Record<Interval['unit'], () => string> = {
  days: m['tasks.unit-days'],
  weeks: m['tasks.unit-weeks'],
  months: m['tasks.unit-months'],
};

/**
 * How often a task is done, in words: its frequency, its advanced schedule (ADR-0004 §3), or about
 * how long after it was last done.
 */
export function howOften(
  task: { frequency: Repeat; every?: Interval | undefined; schedule?: ScheduleData | undefined },
  locale: string,
) {
  const { every, schedule } = task;
  if (schedule) return scheduleWords(schedule, locale);
  if (!every) return repeatWords[task.frequency]();
  const count = { count: every.count };
  if (every.unit === 'days') return m['tasks.every-days'](count);
  if (every.unit === 'weeks') return m['tasks.every-weeks'](count);
  return m['tasks.every-months'](count);
}

/** How due a "since last done" task is, in words, never by the bar alone (ADR-0004 §8, UI-9). */
export function duenessWords({ daysUntilDue }: Dueness) {
  if (daysUntilDue === 0) return m['tasks.due-today']();
  if (daysUntilDue > 0) return m['tasks.due-in']({ count: daysUntilDue });
  return m['tasks.overdue']({ count: -daysUntilDue });
}

/** What happens to an occurrence that isn't done, in words (ADR-0002 §2). */
export const onMissWords: Record<PlanTask['onMiss'], () => string> = {
  'roll over': m['tasks.roll-over'],
  lapse: m['tasks.lapse'],
};

/** Why the server refused a field of a task's form, in words (CODE-13). */
export const taskProblems: Record<TaskField, () => string> = {
  name: m['tasks.invalid-name'],
  duration: () => m['tasks.invalid-duration'](taskDuration),
  frequency: m['tasks.invalid-frequency'],
  everyCount: m['tasks.invalid-every-count'],
  everyUnit: m['tasks.invalid-every-unit'],
  start: m['tasks.invalid-start'],
  onMiss: m['tasks.invalid-on-miss'],
  when: m['tasks.invalid-when'],
  window: m['tasks.invalid-window'],
  rules: m['tasks.invalid-rules'],
  extraDates: m['tasks.invalid-extra-dates'],
  exceptionDates: m['tasks.invalid-exception-dates'],
  sharedWith: m['tasks.invalid-shared-with'],
};

/** Why the server refused a field of a one-off task's form, in words (CODE-13). */
export const oneOffProblems: Record<OneOffField, () => string> = {
  name: m['tasks.invalid-name'],
  duration: () => m['tasks.invalid-duration'](taskDuration),
  date: m['tasks.invalid-start'],
  deadline: m['tasks.invalid-deadline'],
  onMiss: m['tasks.invalid-on-miss'],
};

/** The id of a one-off task's field, apart from those of the form for other tasks. */
export const oneOffFieldId = (field: OneOffField) => `one-off-${field}`;

/** The days a window's edge can be on, around the schedule date (ADR-0004 §4, clarification). */
export const edgeDays = [-3, -2, -1, 0, 1, 2, 3] as const;

/** A day around the schedule date in words, such as “the day before”. */
export function edgeDayWords(dayOffset: number) {
  if (dayOffset === 0) return m['tasks.day-itself']();
  if (dayOffset === -1) return m['tasks.day-before']();
  if (dayOffset === 1) return m['tasks.day-after']();
  if (dayOffset < 0) return m['tasks.days-before']({ count: -dayOffset });
  return m['tasks.days-after']({ count: dayOffset });
}

/** A fixed window in words: “from the day before at 18:00 to the day itself at 07:00”. */
export function windowWords(window: {
  from: { dayOffset: number; time: string };
  to: { dayOffset: number; time: string };
}) {
  return m['tasks.window-words']({
    from: edgeDayWords(window.from.dayOffset),
    fromTime: window.from.time,
    to: edgeDayWords(window.to.dayOffset),
    toTime: window.to.time,
  });
}
