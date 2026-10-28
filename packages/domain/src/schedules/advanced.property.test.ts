import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advancedRule,
  advancedRuleOf,
  weekdays,
  weekdaysOfMonth,
  type AdvancedRule,
} from './advanced';
import { expand } from './expand';

// Invariants of the advanced editor's rules over generated ones (ADR-0004 §3; TEST-1).

const start = fc
  .integer({ min: 0, max: 2 * 366 })
  .map((n) => Temporal.PlainDate.from('2026-01-01').add({ days: n }));
const some = <T>(values: readonly T[]) =>
  fc.uniqueArray(fc.constantFrom(...values), { minLength: 1, maxLength: values.length });

const rule: fc.Arbitrary<AdvancedRule> = fc.oneof(
  fc.record({
    kind: fc.constant('weeks' as const),
    every: fc.integer({ min: 1, max: 52 }),
    days: some(weekdays),
    start,
  }),
  fc.record({
    kind: fc.constant('months' as const),
    every: fc.integer({ min: 1, max: 12 }),
    start,
  }),
  fc.record({
    kind: fc.constant('weekdays-of-month' as const),
    every: fc.integer({ min: 1, max: 12 }),
    which: some(weekdaysOfMonth),
    day: fc.constantFrom(...weekdays),
    start,
  }),
  fc.record({ kind: fc.constant('year' as const), start }),
);

const sorted = (list: readonly number[]) =>
  list.toSorted((a, b) => (a < 0 ? 5 : a) - (b < 0 ? 5 : b));
const normal = (r: AdvancedRule) =>
  r.kind === 'weeks'
    ? { ...r, days: sorted(r.days) }
    : r.kind === 'weekdays-of-month'
      ? { ...r, which: sorted(r.which) }
      : r;

describe('advanced rule invariants (ADR-0004 §3)', () => {
  it('read back as the rule they were made from, days in order', () => {
    fc.assert(
      fc.property(rule, (r) => {
        expect(advancedRuleOf(advancedRule(r))).toEqual(normal(r));
      }),
    );
  });

  it('produce dates only from their first time on, on one of their weekdays', () => {
    fc.assert(
      fc.property(rule, (r) => {
        const schedule = { rules: [advancedRule(r)], extraDates: [], exceptionDates: [] };
        const produced = expand(
          schedule,
          r.start.subtract({ days: 40 }),
          r.start.add({ days: 400 }),
        );
        expect(produced.length).toBeGreaterThan(0);
        for (const d of produced) {
          expect(Temporal.PlainDate.compare(d, r.start)).toBeGreaterThanOrEqual(0);
          if (r.kind === 'weeks') expect(r.days).toContain(d.dayOfWeek);
          if (r.kind === 'weekdays-of-month') expect(d.dayOfWeek).toBe(r.day);
        }
      }),
    );
  });
});
