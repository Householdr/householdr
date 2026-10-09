/**
 * The household's date at `now`: the day it is then in its time zone, which its rules about days
 * go by, such as a child's 18th birthday (ADR-0008 §11, ADR-0010 §7).
 */
export function householdDate(now: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return now.toZonedDateTimeISO(timeZone).toPlainDate();
}
