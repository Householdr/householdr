import { RRuleTemporal } from 'rrule-temporal';
import type { Rule } from './schedule';

// A date a rule asks for that doesn't exist moves to the first day of the next month
// (RFC 7529 SKIP=FORWARD; ADR-0004 §3, clarification).
export function recurrence(rule: Rule) {
  const start = rule.start.toString().replaceAll('-', '');
  return new RRuleTemporal({
    temporal: Temporal,
    rruleString: `DTSTART;VALUE=DATE:${start}\nRRULE:RSCALE=GREGORIAN;SKIP=FORWARD;${rule.rrule}`,
  });
}

// Date-only rules are evaluated in UTC; time zones apply when dates become occurrence windows
// (ADR-0004 §4, §6).
export function atMidnight(date: Temporal.PlainDate) {
  return date.toZonedDateTime({ timeZone: 'UTC' });
}

const units = { DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years' } as const;

/** The rule's normal spacing between dates: its `INTERVAL` in units of its `FREQ`. */
export function spacing(rule: Rule): Temporal.DurationLike {
  const { freq, interval } = recurrence(rule).options();
  const unit = units[freq as keyof typeof units];
  return { [unit]: interval ?? 1 };
}

/** Whether the rule produces any date after `date`, ignoring seasons. */
export function continuesAfter(rule: Rule, date: Temporal.PlainDate) {
  return recurrence(rule).next(atMidnight(date), false) !== null;
}
