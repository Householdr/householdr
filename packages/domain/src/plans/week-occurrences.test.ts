import { describe, expect, it } from 'vitest';
import type { PlannedOccurrence } from '../allocation/units';
import type { Timing } from '../schedules/occurrence';
import type { HouseholdCalendar } from '../schedules/week';
import {
  averageWeeklyMinutes,
  weekOccurrences,
  type PlanTask,
  type WeekInput,
} from './week-occurrences';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const time = (iso: string) => Temporal.PlainTime.from(iso);
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };

const flexible: Timing = { kind: 'flexible' };
const floating: Timing = { kind: 'floating' };
const evening: Timing = {
  kind: 'fixed',
  from: { dayOffset: 0, time: time('18:00') },
  to: { dayOffset: 0, time: time('22:00') },
};
const binOut: Timing = {
  kind: 'fixed',
  from: { dayOffset: -1, time: time('18:00') },
  to: { dayOffset: 0, time: time('07:00') },
};
const task = (id: string, duration: number, rrule: string, timing: Timing): PlanTask => ({
  id,
  duration,
  recurrence: {
    kind: 'schedule',
    schedule: { rules: [{ rrule, start: date('2026-01-01') }], extraDates: [], exceptionDates: [] },
    timing,
  },
});
const dishes = task('dishes', 30, 'FREQ=DAILY', evening);
const vacuum = task('vacuum', 45, 'FREQ=WEEKLY;BYDAY=WE', flexible);
const bins = task('bins', 5, 'FREQ=WEEKLY;BYDAY=TU', binOut);
const bathroom = task('bathroom', 40, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', flexible);
const fridge = task('fridge', 60, 'FREQ=MONTHLY;BYMONTHDAY=1', floating);
const filter = task('filter', 60, 'FREQ=MONTHLY;BYMONTHDAY=15', floating);
const oneOff = (id: string, day: string, deadline?: string): PlanTask => ({
  id,
  duration: 60,
  recurrence: {
    kind: 'oneOff',
    date: date(day),
    ...(deadline ? { deadline: date(deadline) } : {}),
  },
});
const oven = (lastDone?: string): PlanTask => ({
  id: 'oven',
  duration: 50,
  recurrence: {
    kind: 'sinceLastDone',
    every: { count: 6, unit: 'weeks' },
    start: date('2026-01-01'),
    ...(lastDone ? { lastDone: date(lastDone) } : {}),
  },
});
const rolled = (id: string, taskId: string, day: string): PlannedOccurrence => ({
  id,
  task: taskId,
  date: date(day),
  window: { start: at(`${day}T00:00`), end: at(`${day}T23:00`) },
});
const away = (from: string, to: string) => ({ from: date(from), to: date(to) });

// Week of Monday 12 October 2026.
const plan = (input: Partial<WeekInput>) =>
  weekOccurrences({
    week: date('2026-10-14'),
    calendar: brussels,
    tasks: [],
    rolledOver: [],
    placedEarlier: new Set(),
    away: [],
    ...input,
  });
const ids = (input: Partial<WeekInput>) => plan(input).occurrences.map((o) => o.id);
const shown = (o: PlannedOccurrence | undefined) =>
  o && [o.window.start.toPlainDateTime().toString(), o.window.end.toPlainDateTime().toString()];
const week = ['2026-10-12T00:00:00', '2026-10-19T00:00:00'];

describe('weekOccurrences, due this week (ADR-0001 §7 step 1)', () => {
  it('plans the dates of the week, each with its window', () => {
    const result = plan({ tasks: [vacuum, bins] });
    expect(result.occurrences.map((o) => [o.id, ...(shown(o) ?? [])])).toEqual([
      ['vacuum@2026-10-14', ...week],
      ['bins@2026-10-13', '2026-10-12T18:00:00', '2026-10-13T07:00:00'],
    ]);
    expect(result.planned).toBe(true);
  });

  it('plans a daily task seven times', () => {
    expect(ids({ tasks: [dishes] })).toHaveLength(7);
  });

  it('plans a one-off task in the week of its date', () => {
    expect(ids({ tasks: [oneOff('shelf', '2026-10-15')] })).toEqual(['shelf@2026-10-15']);
    expect(ids({ tasks: [oneOff('shelf', '2026-10-22')] })).toEqual([]);
  });
});

describe('weekOccurrences, "since last done" (ADR-0004 §8)', () => {
  it('plans the one open occurrence in the week it is due, and while it is overdue', () => {
    expect(ids({ tasks: [oven('2026-09-03')] })).toEqual(['oven@2026-10-15']);
    expect(ids({ tasks: [oven('2026-08-20')] })).toEqual(['oven@2026-10-01']);
    expect(ids({ tasks: [oven('2026-09-10')] })).toEqual([]);
  });

  it('gives it the whole week', () => {
    expect(shown(plan({ tasks: [oven('2026-08-20')] }).occurrences[0])).toEqual(week);
  });
});

describe('weekOccurrences, rolled over (ADR-0002 §2, clarification)', () => {
  it('keeps a rolled-over occurrence open across the whole week', () => {
    const result = plan({
      tasks: [bathroom],
      rolledOver: [rolled('bathroom@2026-10-09', 'bathroom', '2026-10-09')],
    });
    expect(result.occurrences.map((o) => [o.id, ...(shown(o) ?? [])])).toEqual([
      ['bathroom@2026-10-09', ...week],
    ]);
    expect(result.replaced).toEqual([]);
  });

  it('closes it as missed when the task has a new occurrence this week', () => {
    const result = plan({
      tasks: [vacuum],
      rolledOver: [rolled('vacuum@2026-10-07', 'vacuum', '2026-10-07')],
    });
    expect(result.occurrences.map((o) => o.id)).toEqual(['vacuum@2026-10-14']);
    expect(result.replaced).toEqual(['vacuum@2026-10-07']);
  });
});

describe('weekOccurrences, household away (ADR-0005 §5, clarification)', () => {
  it('plans nothing for a week entirely away', () => {
    expect(plan({ tasks: [dishes, vacuum], away: [away('2026-10-10', '2026-10-20')] })).toEqual({
      planned: false,
      occurrences: [],
      replaced: [],
      skipped: [],
    });
  });

  it('also when away periods together cover the week', () => {
    const halves = [away('2026-10-12', '2026-10-15'), away('2026-10-16', '2026-10-18')];
    expect(plan({ tasks: [dishes], away: halves }).planned).toBe(false);
  });

  it('skips occurrences whose whole window is away, and plans the rest', () => {
    const result = plan({
      tasks: [dishes, vacuum, bins],
      away: [away('2026-10-12', '2026-10-14')],
    });
    expect(result.skipped).toEqual([
      'bins@2026-10-13',
      'dishes@2026-10-12',
      'dishes@2026-10-13',
      'dishes@2026-10-14',
    ]);
    expect(result.occurrences.map((o) => o.id)).toEqual([
      'vacuum@2026-10-14',
      'dishes@2026-10-15',
      'dishes@2026-10-16',
      'dishes@2026-10-17',
      'dishes@2026-10-18',
    ]);
  });

  it('still plans a bin put out the evening before the household leaves', () => {
    const result = plan({ tasks: [bins], away: [away('2026-10-13', '2026-10-14')] });
    expect(result.occurrences.map((o) => o.id)).toEqual(['bins@2026-10-13']);
  });
});

describe('weekOccurrences, floating (ADR-0004 §4, clarification)', () => {
  // Daily dishes (210 minutes a week) against an average of (30 × 365 + 60 × 12) / 52 ≈ 224.
  it('places a floating occurrence in a quiet week, for this week only', () => {
    const result = plan({ tasks: [dishes, fridge] });
    const placed = result.occurrences.find((o) => o.task === 'fridge');
    expect(placed?.id).toBe('fridge@2026-10-01');
    expect(shown(placed)).toEqual(week);
  });

  it('waits in a busy week, until the last week of its window', () => {
    const busy = { tasks: [dishes, fridge, oneOff('paint', '2026-10-13')] };
    expect(ids(busy)).not.toContain('fridge@2026-10-01');
    // Its window runs from the week of 28 September to the week of the next one, 26 October.
    expect(
      ids({
        ...busy,
        week: date('2026-10-21'),
        tasks: [dishes, fridge, oneOff('paint', '2026-10-20')],
      }),
    ).toContain('fridge@2026-10-01');
  });

  it('is placed before a household-away period that covers the rest of its window', () => {
    const busy = { tasks: [dishes, fridge, oneOff('paint', '2026-10-13')] };
    expect(ids({ ...busy, away: [away('2026-10-19', '2026-10-25')] })).toContain(
      'fridge@2026-10-01',
    );
  });

  it('is never placed twice', () => {
    expect(
      ids({ tasks: [dishes, fridge], placedEarlier: new Set(['fridge@2026-10-01']) }),
    ).not.toContain('fridge@2026-10-01');
  });

  it('places the one whose window ends soonest first', () => {
    // The fridge's window ends on 26 October, the filter's on 9 November; only one fits.
    const placed = ids({ tasks: [dishes, filter, fridge] }).filter(
      (id) => !id.startsWith('dishes'),
    );
    expect(placed).toEqual(['fridge@2026-10-01']);
  });

  it('replaces a rolled-over occurrence of the same task when placed', () => {
    const result = plan({
      week: date('2026-10-21'),
      tasks: [fridge],
      rolledOver: [rolled('fridge@2026-09-01', 'fridge', '2026-09-01')],
    });
    expect(result.occurrences.map((o) => o.id)).toEqual(['fridge@2026-10-01']);
    expect(result.replaced).toEqual(['fridge@2026-09-01']);
  });

  it('waits for its last week when there is no schedule to set an average', () => {
    expect(ids({ tasks: [oneOff('shelf', '2026-10-14', '2026-11-06')] })).toEqual([]);
    expect(
      ids({ week: date('2026-11-04'), tasks: [oneOff('shelf', '2026-10-14', '2026-11-06')] }),
    ).toEqual(['shelf@2026-10-14']);
  });

  it('floats a one-off task up to its deadline', () => {
    // Daily dishes alone: 210 minutes against an average of 30 × 365 / 52 ≈ 210.6.
    const shelf = oneOff('shelf', '2026-10-14', '2026-11-06');
    expect(ids({ tasks: [dishes, shelf] })).toContain('shelf@2026-10-14');
    expect(ids({ tasks: [dishes, oneOff('paint', '2026-10-13'), shelf] })).not.toContain(
      'shelf@2026-10-14',
    );
  });
});

describe('averageWeeklyMinutes (ADR-0004 §4, clarification)', () => {
  it('is the minutes the schedules produce in a typical week', () => {
    expect(
      averageWeeklyMinutes([dishes, fridge, oven(), oneOff('x', '2026-10-14')], date('2026-10-12')),
    ).toBeCloseTo((30 * 365 + 60 * 12 + (50 * 365) / 42) / 52, 9);
  });
});
