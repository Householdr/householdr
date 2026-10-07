import { expandWithRules, type ScheduleDate } from './expand';
import { continuesAfter, spacing } from './rule';
import type { Schedule } from './schedule';
import { planWeek, type HouseholdCalendar } from './week';

/** A local time a number of days from the schedule date, as in "day −1 at 18:00". */
export interface WindowEdge {
  dayOffset: number;
  time: Temporal.PlainTime;
}

/**
 * How a task turns a schedule date into an occurrence window (ADR-0004 §4): at fixed times around the
 * date, any time in its plan week, or floating over the weeks until the next occurrence.
 */
export type Timing =
  { kind: 'fixed'; from: WindowEdge; to: WindowEdge } | { kind: 'flexible' } | { kind: 'floating' };

/** When an occurrence may be done: from `start`, up to but not including `end`. */
export interface Window {
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
}

/** One instance of a task: its schedule date and its window (ADR-0001 §1). */
export interface Occurrence {
  date: Temporal.PlainDate;
  window: Window;
}

/** The occurrences of a task whose schedule dates fall from `from` to `to`, both included. */
export function occurrences(
  schedule: Schedule,
  timing: Timing,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): Occurrence[] {
  return expandWithRules(schedule, from, to).map((scheduleDate) => ({
    date: scheduleDate.date,
    window: window(scheduleDate, timing, schedule, calendar),
  }));
}

/**
 * A one-off task's occurrence: flexible within the week of its date, or up to the end of its
 * deadline if it has one (ADR-0004 §4).
 */
export function oneOffOccurrence(
  date: Temporal.PlainDate,
  deadline: Temporal.PlainDate | undefined,
  calendar: HouseholdCalendar,
): Occurrence {
  if (!deadline) return { date, window: weekWindow(date, calendar) };
  if (Temporal.PlainDate.compare(deadline, date) < 0) {
    throw new RangeError(`Deadline ${deadline.toString()} is before ${date.toString()}`);
  }
  const { start } = planWeek(date, calendar);
  return { date, window: between(start, deadline.add({ days: 1 }), calendar) };
}

function window(
  { date, rule }: ScheduleDate,
  timing: Timing,
  schedule: Schedule,
  calendar: HouseholdCalendar,
): Window {
  switch (timing.kind) {
    case 'fixed':
      return fixedWindow(date, timing.from, timing.to, calendar);
    case 'flexible':
      return weekWindow(date, calendar);
    case 'floating':
      return between(
        planWeek(date, calendar).start,
        floatingEnd(date, rule, schedule, calendar),
        calendar,
      );
  }
}

// Local times stay as written across daylight saving; a time that doesn't exist that day (in the
// spring gap) moves forward, and one that exists twice takes the earlier (Temporal's default).
function fixedWindow(
  date: Temporal.PlainDate,
  from: WindowEdge,
  to: WindowEdge,
  calendar: HouseholdCalendar,
): Window {
  const at = (edge: WindowEdge) =>
    date
      .add({ days: edge.dayOffset })
      .toZonedDateTime({ timeZone: calendar.timeZone, plainTime: edge.time });
  const window = { start: at(from), end: at(to) };
  if (Temporal.ZonedDateTime.compare(window.start, window.end) >= 0) {
    throw new RangeError(`Window ends before it starts on ${date.toString()}`);
  }
  return window;
}

function weekWindow(date: Temporal.PlainDate, calendar: HouseholdCalendar) {
  const { start, end } = planWeek(date, calendar);
  return between(start, end, calendar);
}

// The first day of the week where a floating occurrence stops floating (ADR-0004 §4, clarification):
// the earliest of the next occurrence's week, its rule's spacing (or four weeks for an extra date or
// an ended rule), and never less than its own week. Limits are plan week starts, and the four weeks
// are plan weeks, so a transition week (ADR-0006 §1) counts as one.
function floatingEnd(
  date: Temporal.PlainDate,
  rule: ScheduleDate['rule'],
  schedule: Schedule,
  calendar: HouseholdCalendar,
) {
  const weekOf = (d: Temporal.PlainDate) => planWeek(d, calendar).start;
  const ownWeek = planWeek(date, calendar);
  let fourWeeksOn = ownWeek.end;
  for (let week = 1; week < 4; week++) fourWeeksOn = planWeek(fourWeeksOn, calendar).end;
  const limits = [rule ? weekOf(date.add(spacing(rule))) : fourWeeksOn];
  if (rule && !continuesAfter(rule, date)) limits.push(fourWeeksOn);
  const horizon = limits.reduce((a, b) => (Temporal.PlainDate.compare(a, b) <= 0 ? a : b));
  const [next] = expandWithRules(schedule, date.add({ days: 1 }), horizon);
  const end = next ? weekOf(next.date) : horizon;
  return Temporal.PlainDate.compare(end, ownWeek.end) < 0 ? ownWeek.end : end;
}

// From 00:00 on `start` to 00:00 on `end`, in the household's time zone.
function between(start: Temporal.PlainDate, end: Temporal.PlainDate, calendar: HouseholdCalendar) {
  return {
    start: start.toZonedDateTime({ timeZone: calendar.timeZone }),
    end: end.toZonedDateTime({ timeZone: calendar.timeZone }),
  };
}
