/** What a member's fair portion of one plan week depends on (ADR-0001 §6). */
export interface PortionBasis {
  /** The member's share for the week. */
  share: number;
  /** The fraction of the week the member is available. */
  availability: number;
}

/**
 * Each member's fraction of the week's work, in the same order: share × availability over the
 * household's total (ADR-0001 §6). When that total is 0, nobody has a portion.
 */
export function fairFractions(members: readonly PortionBasis[]): number[] {
  const weights = members.map((m) => m.share * m.availability);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (total > 0 ? weight / total : 0));
}
