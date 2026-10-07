import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { changeStartDay, planWeek, type HouseholdCalendar } from './week';

// Plan weeks as a timeline, with and without a change of start day (ADR-0006 §1, TEST-1).

type Weekday = HouseholdCalendar['weekStartDay'];
const weekday = fc.constantFrom<Weekday>(1, 2, 3, 4, 5, 6, 7);
const day = fc
  .integer({ min: 0, max: 400 })
  .map((n) => Temporal.PlainDate.from('2026-01-01').add({ days: n }));
const onOrBefore = (d: Temporal.PlainDate, startDay: number) =>
  d.subtract({ days: (d.dayOfWeek - startDay + 7) % 7 });
const calendar: fc.Arbitrary<HouseholdCalendar> = fc
  .tuple(weekday, fc.option(fc.tuple(weekday, day), { nil: undefined }))
  .map(([weekStartDay, change]) => {
    const base = { timeZone: 'Europe/Brussels', weekStartDay };
    if (!change || change[0] === weekStartDay) return base;
    const [previous, near] = change;
    return { ...base, change: { from: onOrBefore(near, previous), previous } };
  });
const before = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) < 0;

describe('plan week invariants (ADR-0006 §1)', () => {
  it('tiles time with seven-day weeks, apart from one transition week of 4 to 10 days', () => {
    fc.assert(
      fc.property(calendar, day, (c, first) => {
        let week = planWeek(first.subtract({ days: 70 }), c);
        let transitions = 0;
        for (let i = 0; i < 25; i++) {
          const length = week.start.until(week.end).days;
          for (let d = 0; d < length; d++) {
            const same = planWeek(week.start.add({ days: d }), c);
            expect(same.start.equals(week.start) && same.end.equals(week.end)).toBe(true);
          }
          if (c.change && week.start.equals(c.change.from)) {
            transitions++;
            expect(length).toBeGreaterThanOrEqual(4);
            expect(length).toBeLessThanOrEqual(10);
            expect(week.end.dayOfWeek).toBe(c.weekStartDay);
          } else {
            expect(length).toBe(7);
            const startDay =
              c.change && before(week.start, c.change.from) ? c.change.previous : c.weekStartDay;
            expect(week.start.dayOfWeek).toBe(startDay);
          }
          const next = planWeek(week.end, c);
          expect(next.start.equals(week.end)).toBe(true);
          week = next;
        }
        expect(transitions).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('changes the start day from a plan week on, without moving the weeks before it', () => {
    fc.assert(
      fc.property(calendar, weekday, day, (c, newDay, near) => {
        const from = planWeek(near, c).start;
        const changed = changeStartDay(c, newDay, from);
        // A pending change is replaced, so its transition week no longer exists; a finished one is
        // dropped, and only the weeks after its transition week are still described.
        const kept =
          c.change && before(c.change.from, from) ? planWeek(c.change.from, c).end : undefined;
        for (let d = from.subtract({ days: 35 }); before(d, from); d = d.add({ days: 1 })) {
          if (kept && before(d, kept)) continue;
          const old = planWeek(d, c);
          const now = planWeek(d, changed);
          expect(now.start.equals(old.start) && now.end.equals(old.end)).toBe(true);
        }
        const transition = planWeek(from, changed);
        expect(transition.start.equals(from)).toBe(true);
        expect(transition.end.dayOfWeek).toBe(newDay);
        const after = planWeek(transition.end.add({ days: 30 }), changed);
        expect(after.start.dayOfWeek).toBe(newDay);
        expect(after.start.until(after.end).days).toBe(7);
      }),
    );
  });
});
