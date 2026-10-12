import { describe, expect, it } from 'vitest';
import { pastDay } from './past-day';
import type { HouseholdCalendar } from './week';

// Weeks start on Monday; Wednesday 14 October 2026 is today.
const calendar: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const today = Temporal.PlainDate.from('2026-10-14');
const ago = (day: string, inCalendar = calendar) =>
  pastDay(Temporal.PlainDate.from(day), today, inCalendar);

describe('pastDay (ADR-0008 §6, clarification)', () => {
  it('says today and yesterday', () => {
    expect(ago('2026-10-14')).toBe('today');
    expect(ago('2026-10-13')).toBe('yesterday');
  });

  it('says some days ago up to six days, even in the week before', () => {
    expect(ago('2026-10-12')).toBe('some-days-ago');
    expect(ago('2026-10-08')).toBe('some-days-ago');
  });

  it('says last week for the rest of the plan week before this one', () => {
    expect(ago('2026-10-07')).toBe('last-week');
    expect(ago('2026-10-05')).toBe('last-week');
  });

  it('says some weeks ago before that, up to five weeks, then the day itself', () => {
    expect(ago('2026-10-04')).toBe('some-weeks-ago');
    expect(ago('2026-09-10')).toBe('some-weeks-ago');
    expect(ago('2026-09-09')).toBe('older');
  });

  it('follows the household’s own weeks', () => {
    // Weeks start on Thursday: last week ran from 1 to 7 October.
    const thursdays: HouseholdCalendar = { ...calendar, weekStartDay: 4 };
    expect(ago('2026-10-01', thursdays)).toBe('last-week');
    expect(ago('2026-09-30', thursdays)).toBe('some-weeks-ago');
  });

  it('never says a day to come is ahead, which only a clock set back could show', () => {
    expect(ago('2026-10-15')).toBe('today');
  });
});
