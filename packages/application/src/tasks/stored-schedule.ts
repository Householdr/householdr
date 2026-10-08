import type { StoredRule } from '@householdr/db';
import type { Rule, Schedule } from '@householdr/domain';

/** Rules as a schedule's row keeps them, with their dates as ISO strings (ADR-0004 §2). */
export function storedRules(rules: readonly Rule[]): StoredRule[] {
  return rules.map(({ rrule, start, season }) => ({
    rrule,
    start: start.toString(),
    ...(season && { season: { from: season.from.toString(), to: season.to.toString() } }),
  }));
}

/** The schedule a row of `schedules` holds, as the domain reads it. */
export function scheduleOf(row: {
  rules: readonly StoredRule[];
  extraDates: readonly string[];
  exceptionDates: readonly string[];
}): Schedule {
  const day = (iso: string) => Temporal.PlainDate.from(iso);
  return {
    rules: row.rules.map(({ rrule, start, season }) => ({
      rrule,
      start: day(start),
      ...(season && {
        season: {
          from: Temporal.PlainMonthDay.from(season.from),
          to: Temporal.PlainMonthDay.from(season.to),
        },
      }),
    })),
    extraDates: row.extraDates.map(day),
    exceptionDates: row.exceptionDates.map(day),
  };
}
