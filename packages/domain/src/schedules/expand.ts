import { RRuleTemporal } from 'rrule-temporal';
import type { Rule, Schedule, Season } from './schedule';

/**
 * The dates a schedule produces from `from` to `to`, both included, in order (ADR-0004 §2):
 * every rule's dates within its season, plus the extra dates, minus the exception dates.
 */
export function expand(
  schedule: Schedule,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): Temporal.PlainDate[] {
  const dates = new Map<string, Temporal.PlainDate>();
  for (const rule of schedule.rules) {
    for (const date of ruleDates(rule, from, to)) {
      if (!rule.season || inSeason(date, rule.season)) dates.set(date.toString(), date);
    }
  }
  for (const date of schedule.extraDates) {
    if (within(date, from, to)) dates.set(date.toString(), date);
  }
  for (const date of schedule.exceptionDates) dates.delete(date.toString());
  return [...dates.values()].sort((a, b) => Temporal.PlainDate.compare(a, b));
}

// A date a rule asks for that doesn't exist moves to the first day of the next month
// (RFC 7529 SKIP=FORWARD; ADR-0004 §3, clarification).
function ruleDates(rule: Rule, from: Temporal.PlainDate, to: Temporal.PlainDate) {
  const start = rule.start.toString().replaceAll('-', '');
  const recurrence = new RRuleTemporal({
    temporal: Temporal,
    rruleString: `DTSTART;VALUE=DATE:${start}\nRRULE:RSCALE=GREGORIAN;SKIP=FORWARD;${rule.rrule}`,
  });
  return recurrence.between(atMidnight(from), atMidnight(to), true).map((d) => d.toPlainDate());
}

// Date-only rules are evaluated in UTC; time zones apply when dates become occurrence windows
// (ADR-0004 §4, §6).
function atMidnight(date: Temporal.PlainDate) {
  return date.toZonedDateTime({ timeZone: 'UTC' });
}

function within(date: Temporal.PlainDate, from: Temporal.PlainDate, to: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(date, from) >= 0 && Temporal.PlainDate.compare(date, to) <= 0;
}

function inSeason(date: Temporal.PlainDate, season: Season) {
  const day = monthDayKey(date.month, date.day);
  const from = monthDayKey(Number(season.from.monthCode.slice(1)), season.from.day);
  const to = monthDayKey(Number(season.to.monthCode.slice(1)), season.to.day);
  return from <= to ? from <= day && day <= to : day >= from || day <= to;
}

// Orders days within a year, whatever the year: 29 February sorts between 28 February and 1 March.
function monthDayKey(month: number, day: number) {
  return month * 100 + day;
}
