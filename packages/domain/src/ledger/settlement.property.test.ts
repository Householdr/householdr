import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, type AllocationInput } from '../allocation/allocate';
import { settleWeek, type Points } from './settlement';

// Invariants of week settlement over generated households and weeks (TEST-1).

const members = ['m0', 'm1', 'm2', 'm3'];
const points: fc.Arbitrary<Points> = fc.record({
  member: fc.constantFrom(...members),
  points: fc.integer({ min: 0, max: 1200 }).map((n) => n / 4),
});
// Fair fractions that add up to 1, as fairFractions() gives them.
const fairFractions = fc
  .array(fc.integer({ min: 0, max: 10 }), { minLength: 4, maxLength: 4 })
  .filter((weights) => weights.some((w) => w > 0))
  .map((weights) => {
    const total = weights.reduce((sum, w) => sum + w, 0);
    return new Map(members.map((m, i) => [m, (weights[i] ?? 0) / total]));
  });
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

describe('settlement invariants (ADR-0002 §1)', () => {
  it('owes exactly what was allocated, between all members', () => {
    fc.assert(
      fc.property(fairFractions, fc.array(points), fc.array(points), (f, allocated, done) => {
        const settled = settleWeek(f, allocated, done);
        expect(sum(settled.map((s) => s.owed))).toBeCloseTo(sum(allocated.map((a) => a.points)), 9);
        expect(sum(settled.map((s) => s.done))).toBeCloseTo(sum(done.map((d) => d.points)), 9);
        for (const s of settled) expect(s.change).toBeCloseTo(s.done - s.owed, 9);
      }),
    );
  });

  it('changes the balances by nothing overall when the plan is followed exactly', () => {
    fc.assert(
      fc.property(fairFractions, fc.array(points), (f, plan) => {
        expect(sum(settleWeek(f, plan, plan).map((s) => s.change))).toBeCloseTo(0, 9);
      }),
    );
  });

  it('raises only the doer’s balance for one more completion, by its cost', () => {
    fc.assert(
      fc.property(
        fairFractions,
        fc.array(points),
        fc.array(points),
        points,
        (f, allocated, done, extra) => {
          const before = settleWeek(f, allocated, done);
          const after = settleWeek(f, allocated, [...done, extra]);
          after.forEach((s, i) => {
            const raised = s.member === extra.member ? extra.points : 0;
            expect(s.change - (before[i]?.change ?? 0)).toBeCloseTo(raised, 9);
          });
        },
      ),
    );
  });

  it('changes each balance by at most one task when everyone does exactly their plan', () => {
    // Members alike, each available all week, with every task theirs to take: the allocator can
    // only miss each fair portion by its rounding, one occurrence at most (ADR-0002 §1).
    const monday = Temporal.PlainDate.from('2026-10-12');
    const timeZone = 'Europe/Brussels';
    const week = fc.record({
      size: fc.integer({ min: 1, max: 4 }),
      durations: fc.array(fc.integer({ min: 5, max: 120 }), { minLength: 4, maxLength: 4 }),
      occurrences: fc.array(
        fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 7 * 24 - 2 })),
        { maxLength: 14 },
      ),
    });
    fc.assert(
      fc.property(week, ({ size, durations, occurrences }) => {
        const ids = members.slice(0, size);
        const input: AllocationInput = {
          week: monday,
          calendar: { timeZone, weekStartDay: 1 },
          rebalanceRate: 0.25,
          members: ids.map((id) => ({
            id,
            fairFraction: 1 / size,
            availability: { absences: [], unavailable: [] },
            balance: 0,
            load: 0,
            lastWeek: new Set(),
          })),
          tasks: durations.map((duration, i) => ({
            id: `t${String(i)}`,
            duration,
            burden: new Map(ids.map((id) => [id, 1])),
            constraints: new Map(),
          })),
          occurrences: occurrences.map(([task, hour], i) => {
            const start = monday.toZonedDateTime({ timeZone }).add({ hours: hour });
            return {
              id: `o${String(i)}`,
              task: `t${String(task)}`,
              date: start.toPlainDate(),
              window: { start, end: start.add({ hours: 2 }) },
            };
          }),
          preAssigned: new Map(),
          carried: new Map(),
        };
        const plan = allocate(input).assignments.map((a) => ({ member: a.member, points: a.cost }));
        const largest = Math.max(0, ...occurrences.map(([task]) => durations[task] ?? 0));
        const fractions = new Map(ids.map((id) => [id, 1 / size]));
        for (const { change } of settleWeek(fractions, plan, plan)) {
          expect(Math.abs(change)).toBeLessThanOrEqual(largest + 1e-9);
        }
      }),
    );
  });
});
