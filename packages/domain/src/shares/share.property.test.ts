import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planWeek, type HouseholdCalendar } from '../schedules/week';
import { ageShare, overlap, weekShare, type ShareSettings, type TemporaryShare } from './share';

// Invariants of shares over generated members, birth dates and weeks, with and without a change of
// week start day (TEST-1, ADR-0006 §1).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = (max: number) => fc.integer({ min: 0, max }).map((n) => origin.add({ days: n }));
const birthDate = fc.integer({ min: 0, max: 25 * 366 }).map((n) => origin.subtract({ days: n }));
const share = fc.integer({ min: 0, max: 200 }).map((n) => n / 100);
type Weekday = HouseholdCalendar['weekStartDay'];
const weekday = fc.constantFrom<Weekday>(1, 2, 3, 4, 5, 6, 7);
const calendar: fc.Arbitrary<HouseholdCalendar> = fc
  .tuple(weekday, fc.option(fc.tuple(weekday, day(60)), { nil: undefined }))
  .map(([weekStartDay, change]) => {
    const timeZone = 'Europe/Brussels';
    if (!change || change[0] === weekStartDay) return { timeZone, weekStartDay };
    const [previous, near] = change;
    const from = near.subtract({ days: (near.dayOfWeek - previous + 7) % 7 });
    return { timeZone, weekStartDay, change: { from, previous } };
  });
// Temporary shares that never overlap: each starts after the previous one ends.
const temporaries: fc.Arbitrary<TemporaryShare[]> = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 9 }), share), {
    maxLength: 4,
  })
  .map((parts) => {
    let next = origin;
    return parts.map(([gap, length, value]) => {
      const from = next.add({ days: gap });
      next = from.add({ days: length + 1 });
      return { from, to: from.add({ days: length }), share: value };
    });
  });
const settings: fc.Arbitrary<ShareSettings> = fc.record(
  {
    basis: fc.oneof(
      fc.record({ role: fc.constantFrom('head' as const, 'adult' as const) }),
      fc.record({ role: fc.constant('child' as const), birthDate }),
    ),
    override: share,
    temporary: temporaries,
  },
  { requiredKeys: ['basis', 'temporary'] },
);
const base = (s: ShareSettings, d: Temporal.PlainDate, c: HouseholdCalendar) =>
  s.override ?? (s.basis.role === 'child' ? ageShare(s.basis.birthDate, planWeek(d, c).start) : 1);

describe('share invariants (ADR-0001 §4)', () => {
  it('is the same for every day of a plan week', () => {
    fc.assert(
      fc.property(settings, calendar, day(60), fc.integer({ min: 0, max: 9 }), (s, c, d, n) => {
        const { start, end } = planWeek(d, c);
        const other = start.add({ days: n % start.until(end).days });
        expect(weekShare(s, other, c)).toBe(weekShare(s, start, c));
      }),
    );
  });

  it("is the mean of its days' shares, over the week's actual length", () => {
    fc.assert(
      fc.property(settings, calendar, day(60), (s, c, d) => {
        const { start, end } = planWeek(d, c);
        const daily: number[] = [];
        for (
          let day = start;
          Temporal.PlainDate.compare(day, end) < 0;
          day = day.add({ days: 1 })
        ) {
          const covering = s.temporary.find(
            (t) =>
              Temporal.PlainDate.compare(t.from, day) <= 0 &&
              Temporal.PlainDate.compare(day, t.to) <= 0,
          );
          daily.push(covering ? covering.share : base(s, d, c));
        }
        const mean = daily.reduce((sum, share) => sum + share, 0) / daily.length;
        expect(weekShare(s, d, c)).toBeCloseTo(mean, 12);
      }),
    );
  });

  it('counts only the days at home in a week the household is partly away (ADR-0005 §5)', () => {
    fc.assert(
      fc.property(settings, calendar, day(60), day(60), fc.nat(9), (s, c, d, from, length) => {
        const away = [{ from, to: from.add({ days: length }) }];
        const { start, end } = planWeek(d, c);
        const home = (day: Temporal.PlainDate) =>
          Temporal.PlainDate.compare(day, from) < 0 ||
          Temporal.PlainDate.compare(day, away[0]?.to ?? from) > 0;
        const homeDays: Temporal.PlainDate[] = [];
        for (
          let day = start;
          Temporal.PlainDate.compare(day, end) < 0;
          day = day.add({ days: 1 })
        ) {
          if (home(day)) homeDays.push(day);
        }
        // As if the week were only its days at home: each of them weighs the same.
        const daily = homeDays.map((day) => {
          const covering = s.temporary.find(
            (t) =>
              Temporal.PlainDate.compare(t.from, day) <= 0 &&
              Temporal.PlainDate.compare(day, t.to) <= 0,
          );
          return covering ? covering.share : base(s, d, c);
        });
        const expected =
          daily.length === 0
            ? base(s, d, c)
            : daily.reduce((sum, share) => sum + share, 0) / daily.length;
        expect(weekShare(s, d, c, away)).toBeCloseTo(expected, 12);
      }),
    );
  });

  it('is the base share without temporary shares, and lies between the shares of its days', () => {
    fc.assert(
      fc.property(settings, calendar, day(60), (s, c, d) => {
        expect(weekShare({ ...s, temporary: [] }, d, c)).toBe(base(s, d, c));
        const values = [base(s, d, c), ...s.temporary.map((t) => t.share)];
        const result = weekShare(s, d, c);
        expect(result).toBeGreaterThanOrEqual(Math.min(...values) - 1e-12);
        expect(result).toBeLessThanOrEqual(Math.max(...values) + 1e-12);
      }),
    );
  });

  it("never lowers a child's age share as they grow up", () => {
    fc.assert(
      fc.property(birthDate, day(3000), fc.integer({ min: 0, max: 400 }), (b, d, later) => {
        const now = ageShare(b, d);
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now).toBeLessThanOrEqual(1);
        expect(ageShare(b, d.add({ days: later }))).toBeGreaterThanOrEqual(now);
      }),
    );
  });
});

describe('overlap (ADR-0001 §4, clarification)', () => {
  const period = fc
    .tuple(day(60), fc.integer({ min: 0, max: 20 }))
    .map(([from, length]) => ({ from, to: from.add({ days: length }) }));

  it('is symmetric, and true exactly when a day lies in both', () => {
    fc.assert(
      fc.property(period, period, (a, b) => {
        const within = (p: typeof a, d: Temporal.PlainDate) =>
          Temporal.PlainDate.compare(p.from, d) <= 0 && Temporal.PlainDate.compare(d, p.to) <= 0;
        let shared = false;
        for (let d = a.from; Temporal.PlainDate.compare(d, a.to) <= 0; d = d.add({ days: 1 })) {
          if (within(b, d)) shared = true;
        }
        expect(overlap(a, b)).toBe(overlap(b, a));
        expect(overlap(a, b)).toBe(shared);
      }),
    );
  });

  it('never holds between generated temporary shares, which never overlap', () => {
    fc.assert(
      fc.property(temporaries, (list) => {
        list.forEach((a, i) => {
          list.slice(i + 1).forEach((b) => {
            expect(overlap(a, b)).toBe(false);
          });
        });
      }),
    );
  });
});
