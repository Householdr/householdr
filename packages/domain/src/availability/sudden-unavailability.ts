import type { Window } from '../schedules/occurrence';
import { isAvailableDuring, type Availability } from './availability';
import { planWeek, type HouseholdCalendar } from '../schedules/week';

/**
 * The days "I can't today" can last up to, seen from the household's date `today`: today, the
 * default, and the later days of its plan week (ADR-0005 §3, clarification). Away for longer is a
 * planned absence for the days after.
 */
export function unavailableDays(
  today: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): Temporal.PlainDate[] {
  const { end } = planWeek(today, calendar);
  const days: Temporal.PlainDate[] = [];
  for (let day = today; Temporal.PlainDate.compare(day, end) < 0; day = day.add({ days: 1 })) {
    days.push(day);
  }
  return days;
}

/**
 * "I can't today", reported at `now` up to the end of `lastDay` (ADR-0005 §2–§3): from now to
 * 00:00 after that day, in the household's time zone. None for a day it can't last up to.
 */
export function suddenUnavailability(
  now: Temporal.Instant,
  lastDay: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): Window | undefined {
  const { timeZone } = calendar;
  const start = now.toZonedDateTimeISO(timeZone);
  const choices = unavailableDays(start.toPlainDate(), calendar);
  if (!choices.some((day) => day.equals(lastDay))) return undefined;
  return { start, end: lastDay.add({ days: 1 }).toZonedDateTime({ timeZone }) };
}

/**
 * What is left at `now` of an occurrence's `window` that a member with `availability` can no
 * longer do, to re-allocate (ADR-0005 §3, clarification): none when they are available during any
 * part of it, so it stays theirs, nor once the window has passed, as nobody can do it then.
 */
export function windowToReallocate(
  availability: Availability,
  window: Window,
  now: Temporal.Instant,
  calendar: HouseholdCalendar,
): Window | undefined {
  const from = now.toZonedDateTimeISO(calendar.timeZone);
  if (Temporal.ZonedDateTime.compare(window.end, from) <= 0) return undefined;
  const left =
    Temporal.ZonedDateTime.compare(window.start, from) > 0 ? window : { ...window, start: from };
  return isAvailableDuring(availability, left, calendar) ? undefined : left;
}
