import { describe, expect, it } from 'vitest';
import { hasTwoFactors, mayTurnOffTotp, type SignInMethods } from './two-factors';

// Two factors for heads (ADR-0010 §3), for every combination of sign-in methods. "Y" yes, "." no.

/** Every combination, named by its letters: k(ey), p(assword), t(otp), or - for none. */
const combinations: Record<string, SignInMethods> = {};
for (const passkey of [false, true]) {
  for (const password of [false, true]) {
    for (const totp of [false, true]) {
      const name = `${passkey ? 'k' : '-'}${password ? 'p' : '-'}${totp ? 't' : '-'}`;
      combinations[name] = { passkey, password, totp };
    }
  }
}
const row = (check: (methods: SignInMethods) => boolean) =>
  Object.entries(combinations)
    .map(([name, methods]) => `${name}:${check(methods) ? 'Y' : '.'}`)
    .join(' ');

describe('hasTwoFactors (ADR-0010 §3)', () => {
  it('is a passkey, or a password with TOTP', () => {
    expect(row(hasTwoFactors)).toBe('---:. --t:. -p-:. -pt:Y k--:Y k-t:Y kp-:Y kpt:Y');
  });
});

describe('mayTurnOffTotp (ADR-0010 §3)', () => {
  it('refuses a head who would be left without two factors: one without a passkey', () => {
    expect(row((methods) => mayTurnOffTotp(methods, true))).toBe(
      '---:. --t:. -p-:. -pt:. k--:Y k-t:Y kp-:Y kpt:Y',
    );
  });

  it('lets anyone else turn it off', () => {
    expect(row((methods) => mayTurnOffTotp(methods, false))).toBe(
      '---:Y --t:Y -p-:Y -pt:Y k--:Y k-t:Y kp-:Y kpt:Y',
    );
  });
});
