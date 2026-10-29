import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import {
  suddenUnavailability,
  unavailableDays,
  windowLeft,
  windowToReallocate,
} from './sudden-unavailability';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const instant = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`).toInstant();
const days = (list: Temporal.PlainDate[]) => list.map((day) => day.toString());

describe('unavailableDays (ADR-0005 §3, clarification)', () => {
  it('runs from today to the last day of its plan week', () => {
    expect(days(unavailableDays(date('2026-10-14'), brussels))).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
  });

  it('is today alone on the last day of the week', () => {
    expect(days(unavailableDays(date('2026-10-18'), brussels))).toEqual(['2026-10-18']);
  });

  it('follows the household’s week start day', () => {
    const fridays: HouseholdCalendar = { ...brussels, weekStartDay: 5 };
    expect(days(unavailableDays(date('2026-10-14'), fridays))).toEqual([
      '2026-10-14',
      '2026-10-15',
    ]);
  });
});

describe('suddenUnavailability (ADR-0005 §2–§3)', () => {
  it('lasts from now to the end of the day chosen', () => {
    const period = suddenUnavailability(instant('2026-10-14T09:30'), date('2026-10-15'), brussels);
    expect(period?.start.toString()).toBe('2026-10-14T09:30:00+02:00[Europe/Brussels]');
    expect(period?.end.toString()).toBe('2026-10-16T00:00:00+02:00[Europe/Brussels]');
  });

  it('ends at midnight in the household’s time zone, also across a clock change', () => {
    const period = suddenUnavailability(instant('2026-10-24T22:00'), date('2026-10-25'), brussels);
    expect(period?.end.toString()).toBe('2026-10-26T00:00:00+01:00[Europe/Brussels]');
  });

  it('can’t end before today or after the plan week', () => {
    const now = instant('2026-10-14T09:30');
    expect(suddenUnavailability(now, date('2026-10-13'), brussels)).toBeUndefined();
    expect(suddenUnavailability(now, date('2026-10-19'), brussels)).toBeUndefined();
  });

  it('goes by the household’s date', () => {
    // Still the 14th in UTC, but the 15th in Brussels: today is the 15th.
    const justAfterMidnight = instant('2026-10-15T00:30');
    expect(suddenUnavailability(justAfterMidnight, date('2026-10-14'), brussels)).toBeUndefined();
    expect(
      suddenUnavailability(justAfterMidnight, date('2026-10-15'), brussels)?.end.toString(),
    ).toBe('2026-10-16T00:00:00+02:00[Europe/Brussels]');
  });
});

describe('windowToReallocate (ADR-0005 §3, clarification)', () => {
  const zoned = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
  const window = (start: string, end: string) => ({ start: zoned(start), end: zoned(end) });
  const now = instant('2026-10-14T09:30');
  // "I can't today", said at 09:30.
  const today = {
    absences: [],
    unavailable: [suddenUnavailability(now, date('2026-10-14'), brussels)].flatMap((w) =>
      w ? [w] : [],
    ),
  };
  const shown = (
    left: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | undefined,
  ) => left && [left.start.toString(), left.end.toString()];

  it('is what is left of a window they can no longer do any part of', () => {
    expect(
      shown(
        windowToReallocate(today, window('2026-10-14T07:00', '2026-10-14T22:00'), now, brussels),
      ),
    ).toEqual([
      '2026-10-14T09:30:00+02:00[Europe/Brussels]',
      '2026-10-14T22:00:00+02:00[Europe/Brussels]',
    ]);
    expect(
      shown(
        windowToReallocate(today, window('2026-10-14T18:00', '2026-10-14T22:00'), now, brussels),
      ),
    ).toEqual([
      '2026-10-14T18:00:00+02:00[Europe/Brussels]',
      '2026-10-14T22:00:00+02:00[Europe/Brussels]',
    ]);
  });

  it('is none for one they can still do later, even only from midnight', () => {
    const week = window('2026-10-12T00:00', '2026-10-19T00:00');
    expect(windowToReallocate(today, week, now, brussels)).toBeUndefined();
    const tonight = window('2026-10-14T20:00', '2026-10-15T00:01');
    expect(windowToReallocate(today, tonight, now, brussels)).toBeUndefined();
  });

  it('is none for a window gone by, which nobody can do any more', () => {
    const morning = window('2026-10-14T07:00', '2026-10-14T09:30');
    expect(windowToReallocate(today, morning, now, brussels)).toBeUndefined();
  });

  it('counts only what is left, not the part they could have done before', () => {
    const away = {
      absences: [{ from: date('2026-10-14'), to: date('2026-10-14') }],
      unavailable: [],
    };
    const sinceYesterday = window('2026-10-13T07:00', '2026-10-14T22:00');
    expect(shown(windowToReallocate(away, sinceYesterday, now, brussels))?.[0]).toBe(
      '2026-10-14T09:30:00+02:00[Europe/Brussels]',
    );
  });

  it('holds across a clock change', () => {
    const sunday = instant('2026-10-25T09:30');
    const unavailable = suddenUnavailability(sunday, date('2026-10-25'), brussels);
    const before = { absences: [], unavailable: unavailable ? [unavailable] : [] };
    const window25 = window('2026-10-25T00:00', '2026-10-26T00:00');
    expect(shown(windowToReallocate(before, window25, sunday, brussels))).toEqual([
      '2026-10-25T09:30:00+01:00[Europe/Brussels]',
      '2026-10-26T00:00:00+01:00[Europe/Brussels]',
    ]);
  });
});

describe('windowLeft (ADR-0005 §4, clarification)', () => {
  const zoned = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
  const now = instant('2026-10-14T09:30');

  it('is what is left of a window from now, all of one still to come, none of one gone by', () => {
    const today = { start: zoned('2026-10-14T07:00'), end: zoned('2026-10-14T22:00') };
    expect(windowLeft(today, now, brussels)?.start.toString()).toBe(
      '2026-10-14T09:30:00+02:00[Europe/Brussels]',
    );
    const tomorrow = { start: zoned('2026-10-15T07:00'), end: zoned('2026-10-15T22:00') };
    expect(windowLeft(tomorrow, now, brussels)).toEqual(tomorrow);
    const morning = { start: zoned('2026-10-14T07:00'), end: zoned('2026-10-14T09:30') };
    expect(windowLeft(morning, now, brussels)).toBeUndefined();
  });
});
