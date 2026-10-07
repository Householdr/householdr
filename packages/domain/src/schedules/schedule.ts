/**
 * A yearly recurring range of days, both ends included. It may wrap around new year, as in
 * 1 September to 30 June (ADR-0004 §2).
 */
export interface Season {
  from: Temporal.PlainMonthDay;
  to: Temporal.PlainMonthDay;
}

/** An RFC 5545 `RRULE` (without `DTSTART`), its start date and an optional season (ADR-0004 §2). */
export interface Rule {
  rrule: string;
  start: Temporal.PlainDate;
  season?: Season;
}

/** Produces the dates its tasks happen on; tasks refer to it (ADR-0004 §1). */
export interface Schedule {
  rules: readonly Rule[];
  extraDates: readonly Temporal.PlainDate[];
  exceptionDates: readonly Temporal.PlainDate[];
}
