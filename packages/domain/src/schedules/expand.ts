import { atMidnight, recurrence } from './rule';
import type { Rule, Schedule, Season } from './schedule';

/** A date of a schedule, with the first rule that produced it, if a rule did. */
export interface ScheduleDate {
  date: Temporal.PlainDate;
  rule?: Rule;
}

/**
 * The dates a schedule produces from `from` to `to`, both included, in order (ADR-0004 §2):
 * every rule's dates within its season, plus the extra dates, minus the exception dates.
 */
export function expand(
  schedule: Schedule,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): Temporal.PlainDate[] {
  return expandWithRules(schedule, from, to).map(({ date }) => date);
}

/** As {@link expand}, with the rule that produced each date. */
export function expandWithRules(
  schedule: Schedule,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): ScheduleDate[] {
  const dates = new Map<string, ScheduleDate>();
  for (const rule of schedule.rules) {
    for (const date of ruleDates(rule, from, to)) {
      const key = date.toString();
      if (!dates.has(key) && (!rule.season || inSeason(date, rule.season))) {
        dates.set(key, { date, rule });
      }
    }
  }
  for (const date of schedule.extraDates) {
    const key = date.toString();
    if (!dates.has(key) && within(date, from, to)) dates.set(key, { date });
  }
  for (const date of schedule.exceptionDates) dates.delete(date.toString());
  return [...dates.values()].sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));
}

function ruleDates(rule: Rule, from: Temporal.PlainDate, to: Temporal.PlainDate) {
  return recurrence(rule)
    .between(atMidnight(from), atMidnight(to), true)
    .map((d) => d.toPlainDate());
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
