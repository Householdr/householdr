/** How an account can sign in, as far as two factors go (ADR-0010 §2–§3). */
export interface SignInMethods {
  /** At least one passkey. */
  passkey: boolean;
  password: boolean;
  /** Codes from an authenticator app, asked for after the password (ADR-0010 §2). */
  totp: boolean;
}

/**
 * Whether the account signs in with two factors: it has a passkey, or a password with TOTP
 * (ADR-0010 §3). Head powers wait for this.
 */
export function hasTwoFactors({ passkey, password, totp }: SignInMethods): boolean {
  return passkey || (password && totp);
}

/**
 * Whether the account may turn TOTP off: a head keeps two factors, so one without a passkey is
 * refused (ADR-0010 §3). Anyone else may.
 */
export function mayTurnOffTotp(methods: SignInMethods, head: boolean): boolean {
  return !head || hasTwoFactors({ ...methods, totp: false });
}

/**
 * Whether the account may remove a passkey, `left` being how it signs in once that passkey is gone:
 * a head keeps two factors, so one left with neither another passkey nor a password with TOTP is
 * refused (ADR-0010 §3, clarification). Anyone else may.
 */
export function mayRemovePasskey(left: SignInMethods, head: boolean): boolean {
  return !head || hasTwoFactors(left);
}
