import type { Rule } from './schedule';

/** The simple frequencies the task editor offers (ADR-0004 §3). */
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'tri-monthly' | 'yearly';

const rrules: Record<Frequency, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  'tri-monthly': 'FREQ=MONTHLY;INTERVAL=3',
  yearly: 'FREQ=YEARLY',
};

/** The single rule a simple frequency compiles to, anchored on its start date. */
export function frequencyRule(frequency: Frequency, start: Temporal.PlainDate): Rule {
  return { rrule: rrules[frequency], start };
}
