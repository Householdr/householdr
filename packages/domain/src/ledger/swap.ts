/** What an occurrence costs each of the two members of a swap, in points (ADR-0001 §5). */
export interface SwapCosts {
  /** To the member who proposes it. */
  from: number;
  /** To the member it is proposed to. */
  to: number;
}

/**
 * What accepting a swap changes both members' balances by, once each does what they then have
 * (ADR-0002 §5): the proposer gives `give` and takes `take`, nothing for a hand-off. What they owe
 * follows the allocation, not the swap, and each is credited for what they do at their own cost, so
 * a hand-off puts the proposer behind and the other ahead, and an uneven trade moves both by the
 * difference.
 */
export function swapEffect(give: SwapCosts, take: SwapCosts | null): { from: number; to: number } {
  return {
    from: (take?.from ?? 0) - give.from,
    to: give.to - (take?.to ?? 0),
  };
}
