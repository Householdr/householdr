import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { ageShare, weekShare, type ShareSettings } from './share';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const mondays: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const sundays: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 7 };
const adult: ShareSettings = { basis: { role: 'adult' }, temporary: [] };
const child = (birthDate: string): ShareSettings => ({
  basis: { role: 'child', birthDate: date(birthDate) },
  temporary: [],
});
const temporary = (from: string, to: string, share: number) => ({
  from: date(from),
  to: date(to),
  share,
});

// Week of Monday 12 October 2026.
const week = date('2026-10-12');

describe('ageShare (ADR-0001 §4)', () => {
  it('follows the curve from 0.1 at 4 to 1.0 at 18', () => {
    expect(ageShare(date('2022-10-12'), week)).toBe(0.1);
    expect(ageShare(date('2018-10-12'), week)).toBeCloseTo(0.36, 2);
    expect(ageShare(date('2013-10-12'), week)).toBeCloseTo(0.68, 2);
    expect(ageShare(date('2008-10-12'), week)).toBe(1);
    expect(ageShare(date('1990-01-01'), week)).toBe(1);
  });

  it('is 0 under 4, up to the day before the 4th birthday', () => {
    expect(ageShare(date('2022-10-13'), week)).toBe(0);
    expect(ageShare(date('2026-01-01'), week)).toBe(0);
  });

  it('counts a 29 February birthday from 1 March in other years', () => {
    expect(ageShare(date('2012-02-29'), date('2030-02-28'))).toBeCloseTo(0.1 + (13 * 0.9) / 14);
    expect(ageShare(date('2012-02-29'), date('2030-03-01'))).toBe(1);
  });
});

describe('weekShare (ADR-0001 §4)', () => {
  it('is 1.0 for heads and adults', () => {
    expect(weekShare(adult, week, mondays)).toBe(1);
    expect(weekShare({ ...adult, basis: { role: 'head' } }, week, mondays)).toBe(1);
  });

  it("is a head's override instead of the default", () => {
    expect(weekShare({ ...adult, override: 0.5 }, week, mondays)).toBe(0.5);
  });

  it("uses a child's age on the first day of the plan week", () => {
    // Turns 12 on Wednesday 14 October: still 11 for that week, whichever day is asked about.
    const sam = child('2014-10-14');
    expect(weekShare(sam, date('2026-10-16'), mondays)).toBeCloseTo(0.1 + (7 * 0.9) / 14);
    expect(weekShare(sam, date('2026-10-19'), mondays)).toBeCloseTo(0.1 + (8 * 0.9) / 14);
  });

  it("depends on the household's week start day", () => {
    // Turns 12 on Monday 12 October: a week starting on Sunday the 11th still counts 11.
    const sam = child('2014-10-12');
    expect(weekShare(sam, week, mondays)).toBeCloseTo(0.1 + (8 * 0.9) / 14);
    expect(weekShare(sam, week, sundays)).toBeCloseTo(0.1 + (7 * 0.9) / 14);
  });

  it("keeps a child's override across birthdays", () => {
    const sam = { ...child('2014-10-14'), override: 0.8 };
    expect(weekShare(sam, week, mondays)).toBe(0.8);
    expect(weekShare(sam, date('2026-10-19'), mondays)).toBe(0.8);
  });

  it('applies a temporary share per day', () => {
    // Half a share from Wednesday to Sunday: two days at 1.0 and five at 0.5.
    const exams = { ...adult, temporary: [temporary('2026-10-14', '2026-10-18', 0.5)] };
    expect(weekShare(exams, week, mondays)).toBeCloseTo((2 + 5 * 0.5) / 7);
  });

  it('includes both dates of a temporary share', () => {
    const oneDay = { ...adult, temporary: [temporary('2026-10-12', '2026-10-12', 0.5)] };
    expect(weekShare(oneDay, week, mondays)).toBeCloseTo(6.5 / 7);
  });

  it('combines several temporary shares in one week', () => {
    const both = {
      ...adult,
      temporary: [
        temporary('2026-10-01', '2026-10-13', 0),
        temporary('2026-10-16', '2026-11-01', 0.5),
      ],
    };
    expect(weekShare(both, week, mondays)).toBeCloseTo((2 * 0 + 2 * 1 + 3 * 0.5) / 7);
  });

  it('ignores temporary shares outside the week', () => {
    const later = { ...adult, temporary: [temporary('2026-10-19', '2026-10-25', 0.5)] };
    expect(weekShare(later, week, mondays)).toBe(1);
  });

  it("replaces an override or a child's age share for the whole week", () => {
    const sam = { ...child('2013-10-01'), temporary: [temporary('2026-10-12', '2026-10-18', 0.2)] };
    expect(weekShare(sam, week, mondays)).toBeCloseTo(0.2);
    const head = { ...adult, override: 0.5, temporary: [temporary('2026-10-05', '2026-10-30', 1)] };
    expect(weekShare(head, week, mondays)).toBeCloseTo(1);
  });

  it('averages over the actual days of a transition week (ADR-0006 §1)', () => {
    // Monday weeks to Friday weeks from 12 October: a four-day week, Monday to Thursday.
    const toFridays: HouseholdCalendar = {
      ...mondays,
      weekStartDay: 5,
      change: { from: week, previous: 1 },
    };
    const exams = { ...adult, temporary: [temporary('2026-10-14', '2026-10-18', 0.5)] };
    expect(weekShare(exams, week, toFridays)).toBeCloseTo((2 + 2 * 0.5) / 4);
    expect(weekShare(child('2010-10-14'), week, toFridays)).toBeCloseTo(
      ageShare(date('2010-10-14'), week),
    );
  });
});
