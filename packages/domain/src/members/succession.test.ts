import { describe, expect, it } from 'vitest';
import { headCandidates, type HeadCandidate } from './succession';

// Who can become head when the last head leaves (ADR-0018 §2, with its clarifications).

const at = (instant: string) => Temporal.Instant.from(instant);

const member = (
  id: string,
  role: HeadCandidate['role'],
  joinedAt: string,
  hasAccount = true,
): HeadCandidate => ({ id, role, hasAccount, joinedAt: at(joinedAt) });

describe('headCandidates (ADR-0018 §2)', () => {
  it('lists the adults with an account, longest in the household first', () => {
    const members = [
      member('c', 'adult', '2026-03-01T00:00:00Z'),
      member('a', 'adult', '2026-01-01T00:00:00Z', false),
      member('b', 'child', '2025-01-01T00:00:00Z'),
      member('d', 'head', '2025-01-01T00:00:00Z'),
      member('e', 'adult', '2026-02-01T00:00:00Z'),
    ];
    expect(headCandidates(members).map(({ id }) => id)).toEqual(['e', 'c']);
  });

  it('orders profiles created at the same moment by their id', () => {
    const members = [
      member('8f0c', 'adult', '2026-01-01T00:00:00Z'),
      member('1a2b', 'adult', '2026-01-01T00:00:00Z'),
    ];
    expect(headCandidates(members).map(({ id }) => id)).toEqual(['1a2b', '8f0c']);
  });

  it('has none without an adult with an account', () => {
    expect(headCandidates([member('a', 'adult', '2026-01-01T00:00:00Z', false)])).toEqual([]);
  });
});
