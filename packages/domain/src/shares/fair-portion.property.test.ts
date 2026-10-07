import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fairFractions } from './fair-portion';

// Invariants of fair portions over generated households (TEST-1).

const share = fc.integer({ min: 0, max: 200 }).map((n) => n / 100);

describe('fair portion invariants (ADR-0001 §6)', () => {
  const member = fc.record({
    share,
    availability: fc.integer({ min: 0, max: 168 }).map((h) => h / 168),
  });

  it('adds up to the whole week, in proportion to share × availability', () => {
    fc.assert(
      fc.property(fc.array(member, { minLength: 1, maxLength: 8 }), (members) => {
        const fractions = fairFractions(members);
        const weights = members.map((m) => m.share * m.availability);
        const total = weights.reduce((sum, w) => sum + w, 0);
        const sum = fractions.reduce((s, f) => s + f, 0);
        expect(sum).toBeCloseTo(total > 0 ? 1 : 0, 12);
        fractions.forEach((f, i) => {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
          expect(f * total).toBeCloseTo(weights[i] ?? Number.NaN, 12);
        });
      }),
    );
  });
});
