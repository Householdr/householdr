import type { TaskField } from '@householdr/application';
import { taskDuration, type Frequency, type PlanTask } from '@householdr/domain';
import { m } from '#lib/paraglide/messages.js';

/** A frequency in words, never as its rule (ADR-0004 §3). */
export const frequencyWords: Record<Frequency, () => string> = {
  daily: m['tasks.daily'],
  weekly: m['tasks.weekly'],
  biweekly: m['tasks.biweekly'],
  monthly: m['tasks.monthly'],
  'tri-monthly': m['tasks.tri-monthly'],
  yearly: m['tasks.yearly'],
};

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
  start: m['tasks.invalid-start'],
  onMiss: m['tasks.invalid-on-miss'],
};
