import type { Repeat, TaskField } from '@householdr/application';
import {
  taskDuration,
  type Dueness,
  type Frequency,
  type Interval,
  type PlanTask,
} from '@householdr/domain';
import { m } from '#lib/paraglide/messages.js';

/** A frequency in words, never as its rule (ADR-0004 §3). */
const frequencyWords: Record<Frequency, () => string> = {
  daily: m['tasks.daily'],
  weekly: m['tasks.weekly'],
  biweekly: m['tasks.biweekly'],
  monthly: m['tasks.monthly'],
  'tri-monthly': m['tasks.tri-monthly'],
  yearly: m['tasks.yearly'],
};

/** The choices of how often a task is done, in words: the frequencies, then "since last done". */
export const repeatWords: Record<Repeat, () => string> = {
  ...frequencyWords,
  'since-last-done': m['tasks.since-last-done'],
};

/** The units of a "since last done" task's interval, in words (ADR-0004 §8). */
export const unitWords: Record<Interval['unit'], () => string> = {
  days: m['tasks.unit-days'],
  weeks: m['tasks.unit-weeks'],
  months: m['tasks.unit-months'],
};

/** How often a task is done, in words: its frequency, or about how long after it was last done. */
export function howOften(task: { frequency: Repeat; every?: Interval | undefined }) {
  const { every } = task;
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
};
