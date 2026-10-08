import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { signInWaits, waitAfter, type WaitRule } from './waits';

// The waits of ADR-0010 §2, clarification.

const seconds = (failures: number, rule: WaitRule = signInWaits.email) =>
  waitAfter(rule, failures).total('seconds');

describe('waitAfter', () => {
  it('lets the free failures through without a wait', () => {
    expect([0, 1, 5].map((n) => seconds(n))).toEqual([0, 0, 0]);
    expect(seconds(20, signInWaits.address)).toBe(0);
  });

  it('then waits 1 second, twice as long after each further failure', () => {
    expect([6, 7, 8, 9, 10, 11].map((n) => seconds(n))).toEqual([1, 2, 4, 8, 16, 32]);
    expect([21, 22, 23].map((n) => seconds(n, signInWaits.address))).toEqual([1, 2, 4]);
  });

  it('never waits longer than a minute for an e-mail address', () => {
    expect([12, 13, 1000].map((n) => seconds(n))).toEqual([60, 60, 60]);
  });

  it('never waits longer than 15 minutes for an IP address', () => {
    expect([30, 31, 10_000].map((n) => seconds(n, signInWaits.address))).toEqual([512, 900, 900]);
  });

  it('never waits less after more failures', () => {
    const rules = fc.constantFrom(signInWaits.email, signInWaits.address);
    fc.assert(
      fc.property(rules, fc.nat(100_000), fc.nat(100), (rule, failures, more) => {
        expect(seconds(failures + more, rule)).toBeGreaterThanOrEqual(seconds(failures, rule));
      }),
    );
  });
});
