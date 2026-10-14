import type { Role } from '../permissions/household';

/** A member of the household, as the rule for who becomes head sees them. */
export interface HeadCandidate {
  id: string;
  role: Role;
  hasAccount: boolean;
  /**
   * When their profile was added to the household, however much later an account was linked to it
   * (ADR-0018 §2, clarification).
   */
  joinedAt: Temporal.Instant;
}

/**
 * The members who can become head when the last head leaves, longest in the household first: the
 * adults with an account, since profiles without one are skipped and children can't be heads
 * (ADR-0018 §2, ADR-0010 §7). The first is who becomes head when the last head names no one, or the
 * one they named declines; profiles created at the same moment are ordered by their id, so the same
 * household always gets the same one (ADR-0018 §2, clarifications). With none, leaving closes the
 * household.
 */
export function headCandidates<T extends HeadCandidate>(members: readonly T[]): T[] {
  return members
    .filter((member) => member.role === 'adult' && member.hasAccount)
    .sort(
      (a, b) =>
        Temporal.Instant.compare(a.joinedAt, b.joinedAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
