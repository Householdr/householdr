import { flags, type FlagKey } from '@householdr/application';

/** The cookie through which an end-to-end test forces flags, as `sign-in=on&other=off`. */
export const testFlagsCookie = 'test-flags';

/**
 * `values` with the flags a test forces in `forced`, the value of `testFlagsCookie` (ADR-0015 §10).
 * Only the test build calls it, so production has no way to force a flag. An unknown flag or value
 * is an error, so a test with a typo fails rather than testing the default.
 */
export function withForcedFlags(
  values: Record<FlagKey, boolean>,
  forced: string | undefined,
): Record<FlagKey, boolean> {
  const result = { ...values };
  for (const [key, value] of new URLSearchParams(forced)) {
    if (!Object.hasOwn(flags, key)) throw new Error(`No flag ${key} in the registry.`);
    if (value !== 'on' && value !== 'off') throw new Error(`Force ${key} on or off, not ${value}.`);
    result[key as FlagKey] = value === 'on';
  }
  return result;
}
