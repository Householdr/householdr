import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inRandomOrder, nextPair } from './next-pair';

// Invariants of the pair the comparison game asks next, over generated estimates (TEST-1).

// On a grid, so different gaps differ by more than rounding.
const theta = fc.integer({ min: -30, max: 30 }).map((n) => n / 10);
const uncertainty = fc.integer({ min: 1, max: 20 }).map((n) => n / 20);
/** Up to eight tasks with distinct ids, as `[id, estimate]` entries. */
const entries = (estimate = fc.record({ theta, uncertainty })) =>
  fc.uniqueArray(fc.tuple(fc.string({ maxLength: 4 }), estimate), {
    selector: ([id]) => id,
    maxLength: 8,
  });
const pairs = (n: number) => (n < 2 ? 0 : (n * (n - 1)) / 2);
/** A number from 0 up to 1, as a random draw gives it. */
const draw = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

describe('the next pair of the comparison game (ADR-0003 §3a)', () => {
  it('asks about two different tasks it was given, or nothing with fewer than two', () => {
    fc.assert(
      fc.property(entries(), fc.nat({ max: 100 }), (list, skipped) => {
        const pair = nextPair(new Map(list), skipped);
        if (list.length < 2) {
          expect(pair).toBeNull();
          return;
        }
        if (!pair) throw new Error('No pair');
        const [first, second] = pair;
        expect(first).not.toBe(second);
        const ids = list.map(([id]) => id);
        expect(ids).toContain(first);
        expect(ids).toContain(second);
      }),
    );
  });

  it('asks the same whatever order the tasks come in', () => {
    fc.assert(
      fc.property(entries(), fc.nat({ max: 100 }), (list, skipped) => {
        const reversed = list.toReversed();
        expect(nextPair(new Map(reversed), skipped)).toEqual(nextPair(new Map(list), skipped));
      }),
    );
  });

  it('asks every pair once before asking one again, as the member skips', () => {
    fc.assert(
      fc.property(entries(), (list) => {
        const estimates = new Map(list);
        const count = pairs(list.length);
        const asked = Array.from({ length: count }, (_, skipped) =>
          nextPair(estimates, skipped)?.join(' / '),
        );
        expect(new Set(asked).size).toBe(count);
        if (count > 0) expect(nextPair(estimates, count)).toEqual(nextPair(estimates, 0));
      }),
    );
  });

  it('prefers the closest estimates when all are as uncertain', () => {
    fc.assert(
      fc.property(entries(fc.record({ theta, uncertainty: fc.constant(0.5) })), (list) => {
        fc.pre(list.length >= 2);
        const estimates = new Map(list);
        const pair = nextPair(estimates);
        if (!pair) throw new Error('No pair');
        const gap = ([a, b]: readonly [string, string]) =>
          Math.abs((estimates.get(a)?.theta ?? 0) - (estimates.get(b)?.theta ?? 0));
        for (const [i, [a]] of list.entries()) {
          for (const [b] of list.slice(i + 1)) {
            expect(gap(pair)).toBeLessThanOrEqual(gap([a, b]) + 1e-12);
          }
        }
      }),
    );
  });

  it('prefers the most uncertain tasks when all estimates are level', () => {
    fc.assert(
      fc.property(entries(fc.record({ theta: fc.constant(0), uncertainty })), (list) => {
        fc.pre(list.length >= 2);
        const estimates = new Map(list);
        const pair = nextPair(estimates);
        if (!pair) throw new Error('No pair');
        // The two most uncertain tasks, or as uncertain as them.
        const chosen = pair.map((id) => estimates.get(id)?.uncertainty ?? 0);
        const top = list.map(([, e]) => e.uncertainty).sort((a, b) => b - a);
        expect(Math.min(...chosen)).toBe(top[1]);
        expect(Math.max(...chosen)).toBe(top[0]);
      }),
    );
  });

  it('shows the same two tasks, in the order asked for half the draws and swapped for the others', () => {
    fc.assert(
      fc.property(entries(), fc.nat({ max: 100 }), draw, (list, skipped, chosen) => {
        fc.pre(list.length >= 2);
        const pair = nextPair(new Map(list), skipped);
        if (!pair) throw new Error('No pair');
        const shown = inRandomOrder(pair, chosen);
        expect(shown).toEqual(chosen < 0.5 ? pair : pair.toReversed());
      }),
    );
  });
});
