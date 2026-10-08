import type { Timing } from './occurrence';
import type { Rule, Schedule } from './schedule';

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

/** The simple frequencies, most often first, as the task editor lists them. */
export const frequencies = Object.keys(rrules) as readonly Frequency[];

/** The single rule a simple frequency compiles to, anchored on its start date. */
export function frequencyRule(frequency: Frequency, start: Temporal.PlainDate): Rule {
  return { rrule: rrules[frequency], start };
}

/**
 * The simple frequency a schedule is, read back from its rule so nobody sees `RRULE` syntax
 * (ADR-0004 §3): one rule, without a season, extra or exception dates. Undefined for any other
 * schedule.
 */
export function frequencyOf(schedule: Schedule): Frequency | undefined {
  const [rule, ...others] = schedule.rules;
  if (!rule || others.length > 0 || rule.season) return undefined;
  if (schedule.extraDates.length > 0 || schedule.exceptionDates.length > 0) return undefined;
  return frequencies.find((frequency) => rrules[frequency] === rule.rrule);
}

/**
 * The timing a task on a simple frequency starts with (ADR-0004 §4): flexible within the week of
 * its date, or floating when it recurs monthly or less often.
 */
export function defaultTiming(
  frequency: Frequency,
): Extract<Timing, { kind: 'flexible' | 'floating' }> {
  switch (frequency) {
    case 'daily':
    case 'weekly':
    case 'biweekly':
      return { kind: 'flexible' };
    case 'monthly':
    case 'tri-monthly':
    case 'yearly':
      return { kind: 'floating' };
  }
}
