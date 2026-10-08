import { describe, expect, it } from 'vitest';
import {
  dueDate,
  dueness,
  sinceLastDoneOccurrence,
  spreadFirstDueDates,
  type AwayPeriod,
  type SinceLastDone,
} from './since-last-done';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const away = (from: string, to: string): AwayPeriod => ({ from: date(from), to: date(to) });
const every = (count: number, unit: SinceLastDone['every']['unit']): SinceLastDone => ({
  every: { count, unit },
  start: date('2026-09-01'),
});
const due = (task: SinceLastDone, lastDone: string | undefined, periods: AwayPeriod[] = []) =>
  dueDate(task, lastDone ? date(lastDone) : undefined, periods).toString();

describe('dueDate (ADR-0004 §8)', () => {
  it('is the last completion plus the interval', () => {
    expect(due(every(42, 'days'), '2026-10-01')).toBe('2026-11-12');
    expect(due(every(6, 'weeks'), '2026-10-01')).toBe('2026-11-12');
    expect(due(every(2, 'months'), '2026-10-15')).toBe('2026-12-15');
  });

  it('is the start date for a task that was never done', () => {
    expect(due(every(42, 'days'), undefined)).toBe('2026-09-01');
  });

  it('moves a month-end that does not exist to the 1st of the next month', () => {
    expect(due(every(1, 'months'), '2026-01-31')).toBe('2026-03-01');
    expect(due(every(1, 'months'), '2026-03-31')).toBe('2026-05-01');
    expect(due(every(12, 'months'), '2028-02-29')).toBe('2029-03-01');
  });
});

describe('the clock pauses while the household is away (ADR-0005 §5)', () => {
  it('moves the due date on by the away days', () => {
    expect(due(every(10, 'days'), '2026-10-01', [away('2026-10-05', '2026-10-08')])).toBe(
      '2026-10-15',
    );
  });

  it('never falls while the household is away', () => {
    expect(due(every(10, 'days'), '2026-01-01', [away('2026-01-10', '2026-01-20')])).toBe(
      '2026-01-22',
    );
  });

  it('counts several periods, and only the days after the last completion', () => {
    const periods = [away('2026-09-28', '2026-10-03'), away('2026-10-10', '2026-10-11')];
    expect(due(every(10, 'days'), '2026-10-01', periods)).toBe('2026-10-15');
  });

  it('counts a day once when away periods overlap', () => {
    const periods = [away('2026-01-01', '2026-01-02'), away('2026-01-01', '2026-01-02')];
    expect(due(every(1, 'days'), '2026-01-01', periods)).toBe('2026-01-03');
  });

  it('ignores periods before the last completion or after the due date', () => {
    const periods = [away('2026-08-01', '2026-08-31'), away('2026-12-01', '2026-12-31')];
    expect(due(every(10, 'days'), '2026-10-01', periods)).toBe('2026-10-11');
  });

  it('makes a never-done task due on the first day back', () => {
    expect(due(every(10, 'days'), undefined, [away('2026-08-25', '2026-09-03')])).toBe(
      '2026-09-04',
    );
    expect(
      due(every(10, 'days'), undefined, [
        away('2026-08-25', '2026-09-03'),
        away('2026-09-04', '2026-09-05'),
      ]),
    ).toBe('2026-09-06');
  });
});

describe('dueness (ADR-0004 §8)', () => {
  const task = every(10, 'days');
  const at = (today: string, periods: AwayPeriod[] = []) =>
    dueness(task, date('2026-10-01'), periods, date(today));

  it('counts down to the due date', () => {
    expect(at('2026-10-06')).toEqual({ daysUntilDue: 5, progress: 0.5 });
  });

  it('says how overdue a chore is, with a full bar', () => {
    expect(at('2026-10-14')).toEqual({ daysUntilDue: -3, progress: 1 });
  });

  it('holds the bar still while the household is away', () => {
    const periods = [away('2026-10-04', '2026-10-08')];
    expect(at('2026-10-03', periods).progress).toBe(0.2);
    expect(at('2026-10-08', periods).progress).toBe(0.2);
    expect(at('2026-10-09', periods).progress).toBe(0.3);
  });

  it('starts empty for a task that was never done', () => {
    expect(dueness(task, undefined, [], date('2026-08-25'))).toEqual({
      daysUntilDue: 7,
      progress: 0,
    });
  });
});

describe('sinceLastDoneOccurrence (ADR-0004 §8)', () => {
  it('is flexible within the week of its due date', () => {
    const { date: dueOn, window } = sinceLastDoneOccurrence(
      every(42, 'days'),
      date('2026-10-01'),
      [],
      {
        timeZone: 'Europe/Brussels',
        weekStartDay: 1,
      },
    );
    expect([dueOn.toString(), window.start.toString(), window.end.toString()]).toEqual([
      '2026-11-12',
      '2026-11-09T00:00:00+01:00[Europe/Brussels]',
      '2026-11-16T00:00:00+01:00[Europe/Brussels]',
    ]);
  });
});

describe('spreadFirstDueDates (ADR-0007 §6)', () => {
  const shown = (map: Map<string, Temporal.PlainDate>) =>
    Object.fromEntries(Array.from(map, ([id, day]) => [id, day.toString()]));
  const oven = { id: 'oven', every: { count: 6, unit: 'weeks' } } as const;
  const windows = { id: 'windows', every: { count: 3, unit: 'months' } } as const;
  const gutters = { id: 'gutters', every: { count: 6, unit: 'months' } } as const;

  it('spreads the first due dates over the intervals, shortest first', () => {
    // 42, 92 and 182 days: offsets 0, 92 / 3 and 182 × 2 / 3.
    expect(shown(spreadFirstDueDates([gutters, oven, windows], date('2026-10-12')))).toEqual({
      oven: '2026-10-12',
      windows: '2026-11-11',
      gutters: '2027-02-10',
    });
  });

  it('makes a single task due at once', () => {
    expect(shown(spreadFirstDueDates([windows], date('2026-10-12')))).toEqual({
      windows: '2026-10-12',
    });
  });

  it('orders equal intervals by id, whatever order they come in', () => {
    const a = { id: 'a', every: { count: 4, unit: 'weeks' } } as const;
    const b = { id: 'b', every: { count: 4, unit: 'weeks' } } as const;
    const expected = { a: '2026-10-12', b: '2026-10-26' };
    expect(shown(spreadFirstDueDates([a, b], date('2026-10-12')))).toEqual(expected);
    expect(shown(spreadFirstDueDates([b, a], date('2026-10-12')))).toEqual(expected);
  });

  it('returns nothing for no tasks', () => {
    expect(spreadFirstDueDates([], date('2026-10-12')).size).toBe(0);
  });
});
