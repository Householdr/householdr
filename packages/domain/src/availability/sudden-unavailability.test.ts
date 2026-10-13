import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { suddenUnavailability, unavailableDays } from './sudden-unavailability';

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
