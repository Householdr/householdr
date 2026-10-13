import { describe, expect, it } from 'vitest';
import {
  changedStartRange,
  isFixedWindow,
  isOneOffDeadline,
  isStartDay,
  isTaskDuration,
  isTaskInterval,
  startRange,
} from './task';

// What a new or changed task may be (ADR-0001 §5, ADR-0004 §3–§4), from examples (TEST-1).

const date = (iso: string) => Temporal.PlainDate.from(iso);

describe('isTaskDuration (ADR-0001 §5)', () => {
  it('takes whole minutes, from a minute to a day', () => {
    for (const minutes of [1, 5, 30, 90, 1440]) expect(isTaskDuration(minutes)).toBe(true);
    for (const minutes of [0, -5, 1441, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isTaskDuration(minutes)).toBe(false);
    }
  });
});

describe('isTaskInterval (ADR-0004 §8)', () => {
  it('takes whole numbers from 1 up to a year in each unit', () => {
    for (const every of [
      { count: 1, unit: 'days' },
      { count: 365, unit: 'days' },
      { count: 6, unit: 'weeks' },
      { count: 52, unit: 'weeks' },
      { count: 12, unit: 'months' },
    ] as const) {
      expect(isTaskInterval(every)).toBe(true);
    }
    for (const every of [
      { count: 0, unit: 'days' },
      { count: 366, unit: 'days' },
      { count: 53, unit: 'weeks' },
      { count: 13, unit: 'months' },
      { count: 1.5, unit: 'weeks' },
      { count: -1, unit: 'months' },
      { count: Number.NaN, unit: 'days' },
    ] as const) {
      expect(isTaskInterval(every)).toBe(false);
    }
  });
});

describe('startRange (ADR-0004 §3)', () => {
  it('runs from today to a year from today', () => {
    const { earliest, latest } = startRange(date('2026-10-08'));
    expect([earliest.toString(), latest.toString()]).toEqual(['2026-10-08', '2027-10-08']);
  });

  it('ends on the last day of February a year after a leap day', () => {
    expect(startRange(date('2028-02-29')).latest.toString()).toBe('2029-02-28');
  });
});

describe('isStartDay (ADR-0004 §3)', () => {
  const today = date('2026-10-08');

  it('takes a day from today to a year from today', () => {
    for (const day of ['2026-10-08', '2026-10-09', '2027-10-08']) {
      expect(isStartDay(date(day), today)).toBe(true);
    }
    for (const day of ['2026-10-07', '2027-10-09', '2020-01-01']) {
      expect(isStartDay(date(day), today)).toBe(false);
    }
  });

  it('keeps the first time of a task that has started, but moves none to another past day', () => {
    const kept = date('2026-03-02');
    expect(isStartDay(kept, today, kept)).toBe(true);
    for (const day of ['2026-03-01', '2026-03-03', '2026-10-07']) {
      expect(isStartDay(date(day), today, kept)).toBe(false);
    }
    expect(isStartDay(today, today, kept)).toBe(true);
    expect(isStartDay(date('2027-10-08'), today, kept)).toBe(true);
  });
});

describe('isOneOffDeadline (ADR-0004 §4)', () => {
  const today = date('2026-10-08');

  it('takes a day from the one-off’s date up to a year from today', () => {
    const shelf = date('2026-10-14');
    for (const day of ['2026-10-14', '2026-10-30', '2027-10-08']) {
      expect(isOneOffDeadline(date(day), shelf, today)).toBe(true);
    }
    for (const day of ['2026-10-13', '2026-10-08', '2027-10-09']) {
      expect(isOneOffDeadline(date(day), shelf, today)).toBe(false);
    }
  });

  it('keeps the deadline of a changed one-off, but moves none to another past day', () => {
    const passed = date('2026-10-01');
    const kept = date('2026-10-05');
    expect(isOneOffDeadline(kept, passed, today, kept)).toBe(true);
    for (const day of ['2026-10-04', '2026-10-06', '2026-10-07']) {
      expect(isOneOffDeadline(date(day), passed, today, kept)).toBe(false);
    }
    expect(isOneOffDeadline(today, passed, today, kept)).toBe(true);
  });
});

describe('changedStartRange (ADR-0004 §3)', () => {
  const today = date('2026-10-08');
  const range = (kept: string) => {
    const { earliest, latest } = changedStartRange(today, date(kept));
    return [earliest.toString(), latest.toString()];
  };

  it('reaches back to a first time that has passed', () => {
    expect(range('2026-03-02')).toEqual(['2026-03-02', '2027-10-08']);
  });

  it('is the range of a new task while the first time is still to come', () => {
    expect(range('2026-10-08')).toEqual(['2026-10-08', '2027-10-08']);
    expect(range('2027-01-01')).toEqual(['2026-10-08', '2027-10-08']);
  });

  it('reaches a first time past a year from today, as a later time zone can leave it', () => {
    expect(range('2027-10-09')).toEqual(['2026-10-08', '2027-10-09']);
  });
});

describe('isFixedWindow (ADR-0004 §4, clarification)', () => {
  const edge = (dayOffset: number, time: string) => ({
    dayOffset,
    time: Temporal.PlainTime.from(time),
  });

  it('takes a window that ends after it starts, its edges within 3 days of the date', () => {
    // The bins: out the evening before, in the evening after collection.
    expect(isFixedWindow(edge(-1, '18:00'), edge(0, '07:00'))).toBe(true);
    expect(isFixedWindow(edge(0, '12:00'), edge(0, '22:00'))).toBe(true);
    expect(isFixedWindow(edge(-3, '00:00'), edge(3, '23:59'))).toBe(true);
    for (const [from, to] of [
      [edge(0, '07:00'), edge(0, '07:00')],
      [edge(0, '08:00'), edge(0, '07:00')],
      [edge(-4, '18:00'), edge(0, '07:00')],
      [edge(0, '18:00'), edge(4, '07:00')],
      [edge(0.5, '18:00'), edge(1, '07:00')],
    ] as const) {
      expect(isFixedWindow(from, to)).toBe(false);
    }
  });
});
