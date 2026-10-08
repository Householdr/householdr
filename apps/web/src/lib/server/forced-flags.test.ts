import { describe, expect, it } from 'vitest';
import { withForcedFlags } from './forced-flags';

describe('withForcedFlags (ADR-0015 §10)', () => {
  const values = {
    'sign-in': false,
    'password-reset': false,
    onboarding: false,
    passkeys: false,
    'household-settings': false,
    'activity-log': false,
    shares: false,
    availability: false,
    tasks: false,
    plans: false,
  };

  it('turns the flags a test names on or off, and leaves the rest', () => {
    expect(withForcedFlags(values, 'sign-in=on')).toEqual({ ...values, 'sign-in': true });
    expect(withForcedFlags({ ...values, 'sign-in': true }, 'sign-in=off')).toEqual(values);
    expect(withForcedFlags(values, undefined)).toEqual(values);
  });

  it('fails on a flag that isn’t in the registry, or a value that isn’t on or off', () => {
    expect(() => withForcedFlags(values, 'sign-up=on')).toThrow('No flag sign-up');
    expect(() => withForcedFlags(values, 'toString=on')).toThrow('No flag toString');
    expect(() => withForcedFlags(values, 'sign-in=yes')).toThrow('not yes');
  });
});
