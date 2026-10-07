import { describe, expect, it } from 'vitest';
import { changeStartDay, planWeek, type HouseholdCalendar, type PlanWeek } from './week';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const show = (w: PlanWeek) => [w.start.toString(), w.end.toString()];
const plain = (c: HouseholdCalendar): unknown => JSON.parse(JSON.stringify(c));
const mondays: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
// Monday weeks until 12 October 2026, then Thursday weeks: a ten-day transition week.
const toThursdays: HouseholdCalendar = {
  ...mondays,
  weekStartDay: 4,
  change: { from: date('2026-10-12'), previous: 1 },
};

describe('planWeek (ADR-0006 §1)', () => {
  it('finds the week start day on or before the date, for seven days', () => {
    expect(show(planWeek(date('2026-10-07'), mondays))).toEqual(['2026-10-05', '2026-10-12']);
    expect(show(planWeek(date('2026-10-07'), { ...mondays, weekStartDay: 3 }))).toEqual([
      '2026-10-07',
      '2026-10-14',
    ]);
    expect(show(planWeek(date('2026-10-07'), { ...mondays, weekStartDay: 7 }))).toEqual([
      '2026-10-04',
      '2026-10-11',
    ]);
  });

  it('keeps the old start day before the change, then runs the transition week, then the new day', () => {
    expect(show(planWeek(date('2026-10-11'), toThursdays))).toEqual(['2026-10-05', '2026-10-12']);
    expect(show(planWeek(date('2026-10-12'), toThursdays))).toEqual(['2026-10-12', '2026-10-22']);
    expect(show(planWeek(date('2026-10-21'), toThursdays))).toEqual(['2026-10-12', '2026-10-22']);
    expect(show(planWeek(date('2026-10-22'), toThursdays))).toEqual(['2026-10-22', '2026-10-29']);
    expect(show(planWeek(date('2026-11-01'), toThursdays))).toEqual(['2026-10-29', '2026-11-05']);
  });

  it('makes the transition week the one nearest to seven days: 4 to 10', () => {
    const ends = ([2, 3, 4, 5, 6, 7] as const).map((weekStartDay) => [
      weekStartDay,
      planWeek(date('2026-10-12'), { ...toThursdays, weekStartDay }).end.toString(),
    ]);
    expect(ends).toEqual([
      [2, '2026-10-20'],
      [3, '2026-10-21'],
      [4, '2026-10-22'],
      [5, '2026-10-16'],
      [6, '2026-10-17'],
      [7, '2026-10-18'],
    ]);
  });

  it('refuses a change to the same day, or one that does not start on the previous day', () => {
    const same: HouseholdCalendar = { ...toThursdays, weekStartDay: 1 };
    const midWeek: HouseholdCalendar = {
      ...toThursdays,
      change: { from: date('2026-10-13'), previous: 1 },
    };
    expect(() => planWeek(date('2026-10-20'), same)).toThrow(RangeError);
    expect(() => planWeek(date('2026-10-20'), midWeek)).toThrow(RangeError);
  });
});

describe('changeStartDay (ADR-0006 §1, clarification)', () => {
  it('makes the first week without a published plan the transition week', () => {
    expect(plain(changeStartDay(mondays, 4, date('2026-10-12')))).toEqual({
      timeZone: 'Europe/Brussels',
      weekStartDay: 4,
      change: { from: '2026-10-12', previous: 1 },
    });
  });

  it('replaces a change that is still pending, from the old start day', () => {
    expect(plain(changeStartDay(toThursdays, 6, date('2026-10-12')))).toEqual({
      timeZone: 'Europe/Brussels',
      weekStartDay: 6,
      change: { from: '2026-10-12', previous: 1 },
    });
  });

  it('cancels a pending change when a head goes back to the old day', () => {
    expect(plain(changeStartDay(toThursdays, 1, date('2026-10-12')))).toEqual({
      timeZone: 'Europe/Brussels',
      weekStartDay: 1,
    });
  });

  it('starts from the new day once the transition week has a published plan', () => {
    const back = changeStartDay(toThursdays, 1, date('2026-10-22'));
    expect(plain(back)).toEqual({
      timeZone: 'Europe/Brussels',
      weekStartDay: 1,
      change: { from: '2026-10-22', previous: 4 },
    });
    expect(show(planWeek(date('2026-10-22'), back))).toEqual(['2026-10-22', '2026-10-26']);
  });

  it('leaves the calendar as it is when the day does not change', () => {
    expect(changeStartDay(mondays, 1, date('2026-10-12'))).toBe(mondays);
    expect(changeStartDay(toThursdays, 4, date('2026-10-22'))).toBe(toThursdays);
  });

  it('refuses a date that does not start a plan week', () => {
    expect(() => changeStartDay(mondays, 4, date('2026-10-13'))).toThrow(RangeError);
    expect(() => changeStartDay(toThursdays, 1, date('2026-10-19'))).toThrow(RangeError);
  });
});
