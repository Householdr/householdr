import { occurrences, type Window, type WindowEdge } from '../schedules/occurrence';
import type { Schedule } from '../schedules/schedule';
import { planWeek, type HouseholdCalendar } from '../schedules/week';

/**
 * When a member is normally here, in the same model as task schedules (ADR-0005 §2, ADR-0004 §5):
 * each date of the schedule opens a window, such as "every other Friday 18:00 to the next Friday".
 */
export interface AvailabilityPattern {
  schedule: Schedule;
  from: WindowEdge;
  to: WindowEdge;
}

/** A planned absence: whole days in the household's time zone, both ends included. */
export interface Absence {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}

/**
 * A member's availability, in three layers (ADR-0005 §2): an optional recurring pattern (without one,
 * always available), planned absences, and sudden unavailability.
 */
export interface Availability {
  pattern?: AvailabilityPattern;
  absences: readonly Absence[];
  unavailable: readonly Window[];
}

/** The parts of `range` the member is available in, in order and not overlapping. */
export function availableWindows(
  availability: Availability,
  range: Window,
  calendar: HouseholdCalendar,
): Window[] {
  const base = availability.pattern
    ? patternWindows(availability.pattern, range, calendar)
    : [range];
  const away = [
    ...availability.absences.map((a) => days(a.from, a.to.add({ days: 1 }), calendar)),
    ...availability.unavailable,
  ];
  return subtract(intersect(base, range), away);
}

/**
 * The fraction of the plan week of `date` the member is available, over its actual length
 * (ADR-0001 §6, ADR-0005 §2, ADR-0006 §1).
 */
export function availabilityInWeek(
  availability: Availability,
  date: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): number {
  const { start, end } = planWeek(date, calendar);
  const week = days(start, end, calendar);
  return length(availableWindows(availability, week, calendar)) / length([week]);
}

/** Whether the member is available during any part of `window` (ADR-0005 §2, clarification). */
export function isAvailableDuring(
  availability: Availability,
  window: Window,
  calendar: HouseholdCalendar,
): boolean {
  return availableWindows(availability, window, calendar).length > 0;
}

// The pattern's windows that can reach into `range`: a date's window runs from its `from` day to
// its `to` day, so dates up to those offsets outside the range still count.
function patternWindows(pattern: AvailabilityPattern, range: Window, calendar: HouseholdCalendar) {
  const timing = { kind: 'fixed', from: pattern.from, to: pattern.to } as const;
  const first = range.start.toPlainDate().subtract({ days: pattern.to.dayOffset + 1 });
  const last = range.end.toPlainDate().subtract({ days: pattern.from.dayOffset - 1 });
  return merge(occurrences(pattern.schedule, timing, first, last, calendar).map((o) => o.window));
}

function days(start: Temporal.PlainDate, end: Temporal.PlainDate, calendar: HouseholdCalendar) {
  return {
    start: start.toZonedDateTime({ timeZone: calendar.timeZone }),
    end: end.toZonedDateTime({ timeZone: calendar.timeZone }),
  };
}

const before = (a: Temporal.ZonedDateTime, b: Temporal.ZonedDateTime) =>
  Temporal.ZonedDateTime.compare(a, b) < 0;
const latest = (a: Temporal.ZonedDateTime, b: Temporal.ZonedDateTime) => (before(a, b) ? b : a);
const earliest = (a: Temporal.ZonedDateTime, b: Temporal.ZonedDateTime) => (before(a, b) ? a : b);

// Overlapping or touching windows as one, in order.
function merge(windows: readonly Window[]) {
  const sorted = windows.toSorted((a, b) => Temporal.ZonedDateTime.compare(a.start, b.start));
  const result: Window[] = [];
  for (const window of sorted) {
    const last = result.at(-1);
    if (last && !before(last.end, window.start)) {
      result[result.length - 1] = { start: last.start, end: latest(last.end, window.end) };
    } else {
      result.push(window);
    }
  }
  return result;
}

function intersect(windows: readonly Window[], range: Window) {
  return windows
    .map((w) => ({ start: latest(w.start, range.start), end: earliest(w.end, range.end) }))
    .filter((w) => before(w.start, w.end));
}

function subtract(windows: readonly Window[], removed: readonly Window[]) {
  let result = merge(windows);
  for (const cut of merge(removed)) {
    result = result.flatMap((w) => {
      if (!before(cut.start, w.end) || !before(w.start, cut.end)) return [w];
      const parts: Window[] = [];
      if (before(w.start, cut.start)) parts.push({ start: w.start, end: cut.start });
      if (before(cut.end, w.end)) parts.push({ start: cut.end, end: w.end });
      return parts;
    });
  }
  return result;
}

function length(windows: readonly Window[]) {
  let total = 0;
  for (const w of windows) total += w.start.until(w.end).total('seconds');
  return total;
}
