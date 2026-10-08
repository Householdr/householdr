import type { PlannedOccurrence } from '../allocation/units';
import {
  occurrences,
  oneOffOccurrence,
  type Occurrence,
  type Timing,
  type Window,
} from '../schedules/occurrence';
import type { Schedule } from '../schedules/schedule';
import { dueDate, type AwayPeriod, type Interval } from '../schedules/since-last-done';
import { planWeek, type HouseholdCalendar } from '../schedules/week';
import { intervalTimesPerYear, timesPerYear } from '../schedules/yearly';

/** How a task produces occurrences (ADR-0004). */
export type Recurrence =
  | { kind: 'schedule'; schedule: Schedule; timing: Timing }
  | { kind: 'oneOff'; date: Temporal.PlainDate; deadline?: Temporal.PlainDate }
  | {
      kind: 'sinceLastDone';
      every: Interval;
      start: Temporal.PlainDate;
      lastDone?: Temporal.PlainDate;
    };

export interface PlanTask {
  id: string;
  /** In minutes. */
  duration: number;
  recurrence: Recurrence;
  /**
   * What happens to an occurrence that isn't done (ADR-0001 §1, ADR-0002 §2); "since last done"
   * tasks always roll over (ADR-0004 §8).
   */
  onMiss: 'roll over' | 'lapse';
}

export interface WeekInput {
  /** Any day of the plan week. */
  week: Temporal.PlainDate;
  calendar: HouseholdCalendar;
  tasks: readonly PlanTask[];
  /**
   * Occurrences from earlier plans that are still open, each with its own window (as `occurrences`
   * gives it, not the week it was planned in). "Since last done" tasks are left out: they keep
   * their one open occurrence here (ADR-0004 §8).
   */
  open: readonly PlannedOccurrence[];
  /** Floating occurrences an earlier plan already placed, by id. */
  placedEarlier: ReadonlySet<string>;
  away: readonly AwayPeriod[];
}

export interface WeekOccurrences {
  /** False for a week entirely inside a household-away period: no plan (ADR-0005 §5). */
  planned: boolean;
  /** What the allocator gets, in time order. */
  occurrences: PlannedOccurrence[];
  /**
   * Open occurrences that close as missed: lapsing ones whose window has ended, and rolled-over
   * ones a new occurrence of the same task replaces (ADR-0002 §2, clarifications).
   */
  missed: string[];
  /** Occurrences whose whole window falls while the household is away: closed as away. */
  skipped: string[];
}

/**
 * The occurrences of one plan week (ADR-0001 §7 step 1 with ADR-0002 §2, ADR-0004 §4 and §8,
 * ADR-0005 §5 and ADR-0006 §1, clarifications): those due this week, those still open from earlier
 * weeks, and the floating ones placed this week.
 */
export function weekOccurrences(input: WeekInput): WeekOccurrences {
  const { calendar } = input;
  const { start, end } = planWeek(input.week, calendar);
  const isAway = (day: Temporal.PlainDate) =>
    input.away.some(
      (p) =>
        Temporal.PlainDate.compare(p.from, day) <= 0 && Temporal.PlainDate.compare(day, p.to) <= 0,
    );
  const awayThrough = (from: Temporal.PlainDate, until: Temporal.PlainDate) => {
    for (let day = from; Temporal.PlainDate.compare(day, until) < 0; day = day.add({ days: 1 })) {
      if (!isAway(day)) return false;
    }
    return true;
  };
  if (awayThrough(start, end)) return { planned: false, occurrences: [], missed: [], skipped: [] };

  const week = window(start, end, calendar);
  const minutes = new Map(input.tasks.map((t) => [t.id, t.duration]));
  const cost = (o: PlannedOccurrence) => minutes.get(o.task) ?? 0;
  const planned = (task: string, o: Occurrence): PlannedOccurrence => ({
    id: `${task}@${o.date.toString()}`,
    task,
    date: o.date,
    window: o.window,
  });
  const windowAway = (w: Window) =>
    awayThrough(
      w.start.toPlainDate(),
      w.end.subtract({ nanoseconds: 1 }).toPlainDate().add({ days: 1 }),
    );

  const due: PlannedOccurrence[] = [];
  const floating: PlannedOccurrence[] = [];
  const skipped: string[] = [];
  const consider = (o: PlannedOccurrence) => {
    if (windowAway(o.window)) skipped.push(o.id);
    else due.push(o);
  };
  const float = (o: PlannedOccurrence) => {
    if (covers(o.window, week) && !input.placedEarlier.has(o.id)) floating.push(o);
  };

  for (const task of input.tasks) {
    const r = task.recurrence;
    if (r.kind === 'schedule' && r.timing.kind === 'floating') {
      const candidates = occurrences(
        r.schedule,
        r.timing,
        start.subtract({ years: 1 }),
        end,
        calendar,
      );
      for (const o of candidates) float(planned(task.id, o));
    } else if (r.kind === 'schedule') {
      for (const o of occurrences(
        r.schedule,
        r.timing,
        start,
        end.subtract({ days: 1 }),
        calendar,
      )) {
        consider(planned(task.id, o));
      }
    } else if (r.kind === 'oneOff') {
      const o = planned(task.id, oneOffOccurrence(r.date, r.deadline, calendar));
      if (within(o.window, week)) consider(o);
      else float(o);
    } else {
      const date = dueDate({ every: r.every, start: r.start }, r.lastDone, input.away);
      if (Temporal.PlainDate.compare(date, end) < 0)
        due.push(planned(task.id, { date, window: week }));
    }
  }

  // Open occurrences: a lapsing one stays for what is left of its window, then closes as missed; a
  // rolling one takes the whole week, unless a new one of the same task replaces it.
  const missed: string[] = [];
  let kept: PlannedOccurrence[] = [];
  const dueTasks = new Set(due.map((o) => o.task));
  const policy = new Map(input.tasks.map((t) => [t.id, t.onMiss]));
  for (const o of input.open) {
    const onMiss = policy.get(o.task);
    if (!onMiss) throw new RangeError(`Unknown task ${o.task}`);
    if (onMiss === 'lapse') {
      if (compare(o.window.end, week.start) <= 0) missed.push(o.id);
      else kept.push({ ...o, window: clip(o.window, week) });
    } else if (dueTasks.has(o.task)) {
      missed.push(o.id);
    } else {
      kept.push({ ...o, window: week });
    }
  }

  // Floating occurrences go into a quiet week, or into the last week of their window that has a
  // plan, soonest end first (ADR-0004 §4, clarification). The target follows the week's days at
  // home: a transition week's length (ADR-0006 §1, clarification), less the days the household is
  // away (ADR-0005 §5), such as the days before the first week's start (ADR-0007 §3).
  let total = [...due, ...kept].reduce((sum, o) => sum + cost(o), 0);
  let daysHome = 0;
  for (let day = start; Temporal.PlainDate.compare(day, end) < 0; day = day.add({ days: 1 })) {
    if (!isAway(day)) daysHome++;
  }
  const target = (averageWeeklyMinutes(input.tasks, start) * daysHome) / 7;
  const laterPlan = (w: Window) => {
    const last = w.end.toPlainDate();
    for (let s = end; Temporal.PlainDate.compare(s, last) < 0;) {
      const next = planWeek(s, calendar).end;
      if (!awayThrough(s, next)) return true;
      s = next;
    }
    return false;
  };
  const placed: PlannedOccurrence[] = [];
  floating.sort(
    (a, b) =>
      Temporal.ZonedDateTime.compare(a.window.end, b.window.end) ||
      cost(b) - cost(a) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const o of floating) {
    if (total >= target && laterPlan(o.window)) continue;
    placed.push({ ...o, window: clip(o.window, week) });
    total += cost(o);
    for (const backlog of kept.filter((b) => b.task === o.task)) {
      missed.push(backlog.id);
      total -= cost(backlog);
    }
    kept = kept.filter((b) => b.task !== o.task);
  }

  const all = [...due, ...kept, ...placed].sort(
    (a, b) =>
      Temporal.ZonedDateTime.compare(a.window.start, b.window.start) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { planned: true, occurrences: all, missed: missed.sort(), skipped: skipped.sort() };
}

/**
 * The minutes the schedules produce in a typical week: each task's duration times how often it
 * occurs in a year, over 52 (ADR-0004 §4 and §7, clarification). One-off tasks have no schedule.
 */
export function averageWeeklyMinutes(tasks: readonly PlanTask[], from: Temporal.PlainDate) {
  let total = 0;
  for (const task of tasks) {
    const r = task.recurrence;
    if (r.kind === 'schedule') total += task.duration * timesPerYear(r.schedule, from);
    if (r.kind === 'sinceLastDone') total += task.duration * intervalTimesPerYear(r.every);
  }
  return total / 52;
}

function window(start: Temporal.PlainDate, end: Temporal.PlainDate, calendar: HouseholdCalendar) {
  return {
    start: start.toZonedDateTime({ timeZone: calendar.timeZone }),
    end: end.toZonedDateTime({ timeZone: calendar.timeZone }),
  };
}

const compare = (a: Temporal.ZonedDateTime, b: Temporal.ZonedDateTime) =>
  Temporal.ZonedDateTime.compare(a, b);

function covers(w: Window, week: Window) {
  return compare(w.start, week.end) < 0 && compare(week.start, w.end) < 0;
}

function within(w: Window, week: Window) {
  return compare(week.start, w.start) <= 0 && compare(w.end, week.end) <= 0;
}

function clip(w: Window, week: Window): Window {
  return {
    start: compare(w.start, week.start) < 0 ? week.start : w.start,
    end: compare(w.end, week.end) > 0 ? week.end : w.end,
  };
}
