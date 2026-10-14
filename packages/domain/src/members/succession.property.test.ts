import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { headCandidates, type HeadCandidate } from './succession';

// Invariants of who can become head, over generated households (TEST-1, ADR-0018 §2).

const origin = Temporal.Instant.from('2026-01-01T00:00:00Z');
const candidate: fc.Arbitrary<HeadCandidate> = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom('head' as const, 'adult' as const, 'child' as const),
  hasAccount: fc.boolean(),
  // Few distinct moments, so that ties are common.
  joinedAt: fc.integer({ min: 0, max: 5 }).map((days) => origin.add({ hours: 24 * days })),
});
const household = fc.uniqueArray(candidate, { selector: ({ id }) => id, maxLength: 8 });

describe('headCandidates, for any household (ADR-0018 §2)', () => {
  it('gives the same order whatever order the members come in', () => {
    fc.assert(
      fc.property(
        household.chain((members) =>
          fc.tuple(
            fc.constant(members),
            fc.shuffledSubarray(members, { minLength: members.length }),
          ),
        ),
        ([members, shuffled]) => {
          expect(headCandidates(shuffled)).toEqual(headCandidates(members));
        },
      ),
    );
  });

  it('lists exactly the adults with an account, the longest in the household first', () => {
    fc.assert(
      fc.property(household, (members) => {
        const listed = headCandidates(members);
        expect(new Set(listed)).toEqual(
          new Set(members.filter((m) => m.role === 'adult' && m.hasAccount)),
        );
        for (const [before, after] of listed.slice(1).map((m, i) => [listed[i], m] as const)) {
          if (!before) throw new Error('No member');
          expect(Temporal.Instant.compare(before.joinedAt, after.joinedAt)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });
});
