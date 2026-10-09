import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { householdDate } from '../households/date';
import { planWeek, type HouseholdCalendar } from '../schedules/week';
import { firstPlanWeek, startChoices } from './start';
import { goneDays } from './week-occurrences';

// Invariants of starting a household (ADR-0007 §3), over moments across a year and every start
// day, in time zones on both sides of UTC, across daylight-saving changes (TEST-1, TEST-2).

const calendar: fc.Arbitrary<HouseholdCalendar> = fc.record({
  timeZone: fc.constantFrom('Europe/Brussels', 'Europe/Lisbon', 'Europe/Helsinki'),
  weekStartDay: fc.constantFrom<HouseholdCalendar['weekStartDay']>(1, 2, 3, 4, 5, 6, 7),
});
const moment = fc
  .integer({ min: 0, max: 366 * 24 * 60 })
  .map((minutes) => Temporal.Instant.from('2026-01-01T00:00:00Z').add({ minutes }));
const before = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) < 0;

describe('starting a household (ADR-0007 §3)', () => {
  it('starts now in the week of today, or on the start of the week after it', () => {
    fc.assert(
      fc.property(calendar, moment, (cal, now) => {
        const today = householdDate(now, cal.timeZone);
        const thisWeek = firstPlanWeek('now', now, cal);
        expect(before(today, thisWeek.start)).toBe(false);
        expect(before(today, thisWeek.end)).toBe(true);
        const next = firstPlanWeek('week start', now, cal);
        expect(next.start.equals(thisWeek.end)).toBe(true);
        expect(next.start.dayOfWeek).toBe(cal.weekStartDay);
        for (const when of startChoices) {
          const week = firstPlanWeek(when, now, cal);
          expect(planWeek(week.start, cal).end.equals(week.end)).toBe(true);
        }
      }),
    );
  });

  it('counts exactly the days of the week before today as gone, never today', () => {
    fc.assert(
      fc.property(calendar, moment, (cal, now) => {
        const today = householdDate(now, cal.timeZone);
        const week = firstPlanWeek('now', now, cal);
        const gone = goneDays(week, today);
        const goneCount = gone.reduce((n, d) => n + d.from.until(d.to).days + 1, 0);
        expect(goneCount).toBe(week.start.until(today).days);
        for (const d of gone) expect(before(d.to, today)).toBe(true);
        expect(goneDays(firstPlanWeek('week start', now, cal), today)).toEqual([]);
      }),
    );
  });
});
