/** A household's time zone and week start day, which place plan weeks (ADR-0006 §1). */
export interface HouseholdCalendar {
  /** An IANA time zone, such as `Europe/Brussels`. */
  timeZone: string;
  /** The day plan weeks start on: 1 is Monday, 7 is Sunday. */
  weekStartDay: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** The first day of the plan week `date` falls in. */
export function planWeekStart(date: Temporal.PlainDate, weekStartDay: number) {
  return date.subtract({ days: (date.dayOfWeek - weekStartDay + 7) % 7 });
}
