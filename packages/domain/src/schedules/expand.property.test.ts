import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expand } from './expand';
import { frequencyRule, type Frequency } from './frequency';
import type { Schedule, Season } from './schedule';

// Invariants of expand over generated schedules (TEST-1). fast-check prints the seed of any failure,
// so a failing case can be replayed exactly.

const origin = Temporal.PlainDate.from('2024-01-01');
const day = fc.integer({ min: 0, max: 3 * 366 }).map((n) => origin.add({ days: n }));
const frequency = fc.constantFrom<Frequency>(
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'tri-monthly',
  'yearly',
);
const monthDay = fc
  .record({ month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 31 }) })
  .map(({ month, day }) => Temporal.PlainMonthDay.from({ month, day }, { overflow: 'constrain' }));
const season: fc.Arbitrary<Season> = fc.record({ from: monthDay, to: monthDay });
const rule = fc
  .record({ frequency, start: day, season: fc.option(season, { nil: undefined }) })
  .map(({ frequency, start, season }) => ({ ...frequencyRule(frequency, start), season }));
const schedule: fc.Arbitrary<Schedule> = fc.record({
  rules: fc.array(rule, { maxLength: 3 }),
  extraDates: fc.array(day, { maxLength: 5 }),
  exceptionDates: fc.array(day, { maxLength: 5 }),
});
const range = fc
  .tuple(day, day)
  .map(([a, b]): [Temporal.PlainDate, Temporal.PlainDate] =>
    Temporal.PlainDate.compare(a, b) <= 0 ? [a, b] : [b, a],
  );

const iso = (dates: Temporal.PlainDate[]) => dates.map((d) => d.toString());

describe('expand invariants (ADR-0004 §2)', () => {
  it('returns each date once, in order, within the range', () => {
    fc.assert(
      fc.property(schedule, range, (s, [from, to]) => {
        const result = expand(s, from, to);
        result.forEach((d, i) => {
          expect(Temporal.PlainDate.compare(d, from)).toBeGreaterThanOrEqual(0);
          expect(Temporal.PlainDate.compare(d, to)).toBeLessThanOrEqual(0);
          const previous = result[i - 1];
          if (previous) expect(Temporal.PlainDate.compare(previous, d)).toBe(-1);
        });
      }),
    );
  });

  it('never returns an exception date, and always an extra date in range that is not one', () => {
    fc.assert(
      fc.property(schedule, range, (s, [from, to]) => {
        const result = new Set(iso(expand(s, from, to)));
        const exceptions = new Set(iso([...s.exceptionDates]));
        for (const d of exceptions) expect(result.has(d)).toBe(false);
        for (const d of s.extraDates) {
          const inRange =
            Temporal.PlainDate.compare(d, from) >= 0 && Temporal.PlainDate.compare(d, to) <= 0;
          if (inRange && !exceptions.has(d.toString())) expect(result.has(d.toString())).toBe(true);
        }
      }),
    );
  });

  it('gives the same dates for a range as for its two halves', () => {
    fc.assert(
      fc.property(schedule, range, fc.nat(), (s, [from, to], split) => {
        const days = from.until(to).days;
        const middle = from.add({ days: days === 0 ? 0 : split % days });
        const whole = iso(expand(s, from, to));
        const halves = [
          ...iso(expand(s, from, middle)),
          ...iso(expand(s, middle.add({ days: 1 }), to)),
        ];
        expect(halves).toEqual(whole);
      }),
    );
  });

  it('keeps a rule with a season inside that season', () => {
    fc.assert(
      fc.property(rule, season, range, (r, s, [from, to]) => {
        const seasonal = { rules: [{ ...r, season: s }], extraDates: [], exceptionDates: [] };
        const key = (month: number, d: number) => month * 100 + d;
        const lo = key(Number(s.from.monthCode.slice(1)), s.from.day);
        const hi = key(Number(s.to.monthCode.slice(1)), s.to.day);
        for (const d of expand(seasonal, from, to)) {
          const k = key(d.month, d.day);
          expect(lo <= hi ? lo <= k && k <= hi : k >= lo || k <= hi).toBe(true);
        }
      }),
    );
  });

  it('gives a monthly rule exactly twelve dates in every year from its start', () => {
    fc.assert(
      fc.property(day, (start) => {
        const monthly = {
          rules: [frequencyRule('monthly', start)],
          extraDates: [],
          exceptionDates: [],
        };
        const yearEnd = start.add({ years: 1 }).subtract({ days: 1 });
        expect(expand(monthly, start, yearEnd)).toHaveLength(12);
      }),
    );
  });
});
