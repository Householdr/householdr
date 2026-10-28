import { describe, expect, it } from 'vitest';
import { swapEffect } from './swap';

// What a swap does to both balances (ADR-0002 §5).

describe('swapEffect', () => {
  it('puts the proposer of a hand-off behind and the other ahead, each at their own cost', () => {
    expect(swapEffect({ from: 30, to: 45 }, null)).toEqual({ from: -30, to: 45 });
  });

  it('moves both by the difference in an uneven trade', () => {
    expect(swapEffect({ from: 30, to: 30 }, { from: 20, to: 20 })).toEqual({ from: -10, to: 10 });
  });

  it('changes nothing in an even trade', () => {
    expect(swapEffect({ from: 25, to: 25 }, { from: 25, to: 25 })).toEqual({ from: 0, to: 0 });
  });
});
