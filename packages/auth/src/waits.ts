/** How failed attempts of one kind slow down the next attempt (ADR-0010 §2, clarification). */
export interface WaitRule {
  /** Failures before any wait. */
  free: number;
  /** The wait never grows beyond this. */
  longest: Temporal.Duration;
}

/** Failed password sign-ins, counted by what was typed and where it came from. */
export const signInWaits = {
  /** Anyone can make this one grow by typing someone's address, so it stays short. */
  email: { free: 5, longest: Temporal.Duration.from({ minutes: 1 }) },
  address: { free: 20, longest: Temporal.Duration.from({ minutes: 15 }) },
} as const satisfies Record<string, WaitRule>;

/** A count is forgotten 24 hours after its last failure. */
export const forgetFailuresAfter = Temporal.Duration.from({ hours: 24 });

/**
 * How long the next attempt waits after `failures`: nothing for the free ones, then 1 second,
 * twice as long after each further failure, up to the rule's longest.
 */
export function waitAfter(rule: WaitRule, failures: number): Temporal.Duration {
  const beyond = failures - rule.free;
  if (beyond <= 0) return Temporal.Duration.from({ seconds: 0 });
  // Past 2^30 seconds every rule is at its longest; the cap keeps the number exact.
  const seconds = Math.min(2 ** Math.min(beyond - 1, 30), rule.longest.total('seconds'));
  return Temporal.Duration.from({ seconds });
}
