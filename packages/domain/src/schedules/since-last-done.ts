import { oneOffOccurrence, type Occurrence } from './occurrence';
import type { HouseholdCalendar } from './week';

/** How long after the last completion a chore is due again. */
export interface Interval {
  count: number;
  unit: 'days' | 'weeks' | 'months';
}

/** "About every N days after it was last done" (ADR-0004 §8). */
export interface SinceLastDone {
  every: Interval;
  /** When a task that was never done is due. */
  start: Temporal.PlainDate;
}

/** A period the whole household is away, both ends included (ADR-0005 §5). */
export interface AwayPeriod {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}

/**
 * When the chore is due: the last completion plus the interval, or the start date if it was never
 * done. Away days don't count, so they move the due date on (ADR-0004 §8, clarification).
 */
export function dueDate(
  task: SinceLastDone,
  lastDone: Temporal.PlainDate | undefined,
  away: readonly AwayPeriod[],
): Temporal.PlainDate {
  if (!lastDone) return firstDayHome(task.start, away);
  const base = add(lastDone, task.every);
  let due = base;
  for (;;) {
    const paused = awayDays(lastDone, due, away);
    const next = base.add({ days: paused });
    if (next.equals(due)) return due;
    due = next;
  }
}

/** The one open occurrence: flexible within the week of its due date (ADR-0004 §8). */
export function sinceLastDoneOccurrence(
  task: SinceLastDone,
  lastDone: Temporal.PlainDate | undefined,
  away: readonly AwayPeriod[],
  calendar: HouseholdCalendar,
): Occurrence {
  return oneOffOccurrence(dueDate(task, lastDone, away), undefined, calendar);
}

/**
 * First due dates for "since last done" tasks whose last completion nobody knows, such as those
 * added in onboarding: spread over their intervals from `from`, so they don't all fall in the first
 * week (ADR-0007 §6). Shorter intervals come first and ties go by id, so the result never depends
 * on the order of `tasks`.
 */
export function spreadFirstDueDates(
  tasks: readonly { id: string; every: Interval }[],
  from: Temporal.PlainDate,
): Map<string, Temporal.PlainDate> {
  const lengths = tasks.map((task) => ({
    id: task.id,
    days: from.until(add(from, task.every)).days,
  }));
  lengths.sort((a, b) => a.days - b.days || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(
    lengths.map(({ id, days }, i) => [
      id,
      from.add({ days: Math.floor((days * i) / lengths.length) }),
    ]),
  );
}

/** How due the chore is on `today`, for the bar from "just done" to "due" (ADR-0004 §8). */
export interface Dueness {
  /** Days until it is due; negative when overdue. */
  daysUntilDue: number;
  /** From 0 (just done) to 1 (due or overdue), counting days at home only. */
  progress: number;
}

export function dueness(
  task: SinceLastDone,
  lastDone: Temporal.PlainDate | undefined,
  away: readonly AwayPeriod[],
  today: Temporal.PlainDate,
): Dueness {
  const due = dueDate(task, lastDone, away);
  const daysUntilDue = today.until(due).days;
  if (!lastDone || daysUntilDue <= 0) return { daysUntilDue, progress: daysUntilDue <= 0 ? 1 : 0 };
  if (Temporal.PlainDate.compare(today, lastDone) <= 0) return { daysUntilDue, progress: 0 };
  const homeDays = (until: Temporal.PlainDate) =>
    lastDone.until(until).days - awayDays(lastDone, until, away);
  return { daysUntilDue, progress: homeDays(today) / homeDays(due) };
}

// A day that doesn't exist moves to the first day of the next month, as for rules
// (ADR-0004 §3 and §8, clarifications).
function add(date: Temporal.PlainDate, every: Interval) {
  if (every.unit === 'days') return date.add({ days: every.count });
  if (every.unit === 'weeks') return date.add({ weeks: every.count });
  const target = date.add({ months: every.count });
  return target.day < date.day ? target.with({ day: 1 }).add({ months: 1 }) : target;
}

// Away days after `after`, up to and including `through`.
function awayDays(
  after: Temporal.PlainDate,
  through: Temporal.PlainDate,
  away: readonly AwayPeriod[],
) {
  let days = 0;
  for (const period of merged(away)) {
    const from = later(period.from, after.add({ days: 1 }));
    const to = earlier(period.to, through);
    if (Temporal.PlainDate.compare(from, to) <= 0) days += from.until(to).days + 1;
  }
  return days;
}

// Overlapping or adjoining periods as one, so no day counts twice.
function merged(away: readonly AwayPeriod[]) {
  const sorted = away.toSorted((a, b) => Temporal.PlainDate.compare(a.from, b.from));
  const result: AwayPeriod[] = [];
  for (const period of sorted) {
    const last = result.at(-1);
    if (last && Temporal.PlainDate.compare(period.from, last.to.add({ days: 1 })) <= 0) {
      result[result.length - 1] = { from: last.from, to: later(last.to, period.to) };
    } else {
      result.push(period);
    }
  }
  return result;
}

function firstDayHome(date: Temporal.PlainDate, away: readonly AwayPeriod[]) {
  let day = date;
  for (let moved = true; moved;) {
    moved = false;
    for (const period of away) {
      if (within(day, period)) {
        day = period.to.add({ days: 1 });
        moved = true;
      }
    }
  }
  return day;
}

function within(date: Temporal.PlainDate, period: AwayPeriod) {
  return (
    Temporal.PlainDate.compare(date, period.from) >= 0 &&
    Temporal.PlainDate.compare(date, period.to) <= 0
  );
}

function later(a: Temporal.PlainDate, b: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(a, b) >= 0 ? a : b;
}

function earlier(a: Temporal.PlainDate, b: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(a, b) <= 0 ? a : b;
}
