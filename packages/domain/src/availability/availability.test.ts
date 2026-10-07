import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import {
  availabilityInWeek,
  availableWindows,
  isAvailableDuring,
  type Availability,
  type AvailabilityPattern,
} from './availability';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const time = (iso: string) => Temporal.PlainTime.from(iso);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
const window = (start: string, end: string) => ({ start: at(start), end: at(end) });
const nobodyAway: Availability = { absences: [], unavailable: [] };
const pattern = (
  rrule: string,
  start: string,
  from: [number, string],
  to: [number, string],
): AvailabilityPattern => ({
  schedule: { rules: [{ rrule, start: date(start) }], extraDates: [], exceptionDates: [] },
  from: { dayOffset: from[0], time: time(from[1]) },
  to: { dayOffset: to[0], time: time(to[1]) },
});
const shown = (windows: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }[]) =>
  windows.map((w) => [w.start.toPlainDateTime().toString(), w.end.toPlainDateTime().toString()]);

// Week of Monday 12 October 2026 (no clock change).
const week = date('2026-10-12');

describe('availabilityInWeek (ADR-0005 §2)', () => {
  it('is the whole week without a pattern or absences', () => {
    expect(availabilityInWeek(nobodyAway, week, brussels)).toBe(1);
  });

  it('counts a student home from Friday 18:00 to Sunday 18:00', () => {
    const weekends = pattern('FREQ=WEEKLY;BYDAY=FR', '2026-01-02', [0, '18:00'], [2, '18:00']);
    expect(availabilityInWeek({ ...nobodyAway, pattern: weekends }, week, brussels)).toBe(48 / 168);
  });

  it('follows a co-parenting rhythm from Friday to Friday, every other week', () => {
    const alternate = pattern('FREQ=WEEKLY;INTERVAL=2', '2026-10-09', [0, '18:00'], [7, '18:00']);
    const availability = { ...nobodyAway, pattern: alternate };
    // Arrived Friday 9 October: here until Friday 16 October 18:00; back on 23 October and 6 November.
    expect(availabilityInWeek(availability, week, brussels)).toBe((4 * 24 + 18) / 168);
    expect(availabilityInWeek(availability, date('2026-11-02'), brussels)).toBe((2 * 24 + 6) / 168);
    // The weekend of 23 October includes the clock change: one hour longer, in a longer week.
    expect(availabilityInWeek(availability, date('2026-10-19'), brussels)).toBe((2 * 24 + 7) / 169);
  });

  it('takes out planned absences as whole days', () => {
    const trip = {
      ...nobodyAway,
      absences: [{ from: date('2026-10-14'), to: date('2026-10-15') }],
    };
    expect(availabilityInWeek(trip, week, brussels)).toBe(5 / 7);
  });

  it('takes out sudden unavailability', () => {
    const ill = { ...nobodyAway, unavailable: [window('2026-10-13T10:00', '2026-10-14T00:00')] };
    expect(availabilityInWeek(ill, week, brussels)).toBe((168 - 14) / 168);
  });

  it('measures the week the clocks go back as 169 hours', () => {
    const ill = { ...nobodyAway, unavailable: [window('2026-10-19T00:00', '2026-10-20T00:00')] };
    expect(availabilityInWeek(ill, date('2026-10-19'), brussels)).toBe((169 - 24) / 169);
  });

  it('counts an absence once when it overlaps sudden unavailability', () => {
    const both = {
      ...nobodyAway,
      absences: [{ from: date('2026-10-14'), to: date('2026-10-14') }],
      unavailable: [window('2026-10-14T08:00', '2026-10-14T20:00')],
    };
    expect(availabilityInWeek(both, week, brussels)).toBe(6 / 7);
  });
});

describe('availableWindows (ADR-0005 §2)', () => {
  it('lists the parts of a range the member is here, in order', () => {
    const evenings = pattern('FREQ=DAILY', '2026-01-01', [0, '18:00'], [0, '23:00']);
    const availability = {
      pattern: evenings,
      absences: [{ from: date('2026-10-13'), to: date('2026-10-13') }],
      unavailable: [],
    };
    expect(
      shown(
        availableWindows(availability, window('2026-10-12T20:00', '2026-10-14T19:00'), brussels),
      ),
    ).toEqual([
      ['2026-10-12T20:00:00', '2026-10-12T23:00:00'],
      ['2026-10-14T18:00:00', '2026-10-14T19:00:00'],
    ]);
  });
});

describe('back-to-back pattern windows', () => {
  it('join into one window', () => {
    const everyWeek = pattern('FREQ=WEEKLY', '2026-10-09', [0, '18:00'], [7, '18:00']);
    const range = window('2026-10-12T00:00', '2026-10-19T00:00');
    expect(shown(availableWindows({ ...nobodyAway, pattern: everyWeek }, range, brussels))).toEqual(
      [['2026-10-12T00:00:00', '2026-10-19T00:00:00']],
    );
  });
});

describe('isAvailableDuring (ADR-0005 §2, clarification)', () => {
  const homeFromSix = {
    ...nobodyAway,
    pattern: pattern('FREQ=DAILY', '2026-01-01', [0, '18:00'], [1, '08:00']),
  };

  it('is enough to be here for part of the window', () => {
    expect(
      isAvailableDuring(homeFromSix, window('2026-10-13T12:00', '2026-10-13T22:00'), brussels),
    ).toBe(true);
  });

  it('is not enough to be here only outside it', () => {
    expect(
      isAvailableDuring(homeFromSix, window('2026-10-13T09:00', '2026-10-13T17:00'), brussels),
    ).toBe(false);
  });

  it('is not enough when an absence covers it', () => {
    const away = {
      ...homeFromSix,
      absences: [{ from: date('2026-10-13'), to: date('2026-10-13') }],
    };
    expect(isAvailableDuring(away, window('2026-10-13T12:00', '2026-10-13T22:00'), brussels)).toBe(
      false,
    );
  });
});
