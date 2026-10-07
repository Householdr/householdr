import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planWeekStart, type HouseholdCalendar } from '../schedules/week';
import { ageShare, weekShare, type ShareSettings, type TemporaryShare } from './share';

// Invariants of shares over generated members, birth dates and weeks (TEST-1).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = (max: number) => fc.integer({ min: 0, max }).map((n) => origin.add({ days: n }));
const birthDate = fc.integer({ min: 0, max: 25 * 366 }).map((n) => origin.subtract({ days: n }));
const share = fc.integer({ min: 0, max: 200 }).map((n) => n / 100);
const calendar: fc.Arbitrary<HouseholdCalendar> = fc.record({
  timeZone: fc.constant('Europe/Brussels'),
  weekStartDay: fc.constantFrom(1, 2, 3, 4, 5, 6, 7),
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
  s.override ??
  (s.basis.role === 'child' ? ageShare(s.basis.birthDate, planWeekStart(d, c.weekStartDay)) : 1);

describe('share invariants (ADR-0001 §4)', () => {
  it('is the same for every day of a plan week', () => {
    fc.assert(
      fc.property(settings, calendar, day(60), fc.integer({ min: 0, max: 6 }), (s, c, d, n) => {
        const start = planWeekStart(d, c.weekStartDay);
        expect(weekShare(s, start.add({ days: n }), c)).toBe(weekShare(s, start, c));
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
