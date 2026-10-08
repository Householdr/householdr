import type { Clock } from '@householdr/application';
import { countAttempt, forgetCount, withdrawAttempt, type Database } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import * as v from 'valibot';
import type { Auth } from './auth';
import { cookiesFrom, type Cookie } from './cookies';
import { addressPrefix, type CounterKey } from './counter-keys';
import { forgetFailuresAfter, signInWaits, waitAfter } from './waits';

/** What the password sign-in form sends (CODE-12). */
export const passwordSignIn = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
});

/** What signing in needs from the app. */
export interface SignInContext {
  auth: Auth;
  db: Database;
  clock: Clock;
  counterKey: CounterKey;
}

export type SignInResult =
  /** Signed in: the session's cookie, for the response to set. */
  | { ok: true; cookies: Cookie[] }
  /** Shown as "e-mail or password is incorrect", whichever it was (ADR-0010 §2). */
  | { ok: false; error: 'incorrect' }
  /** The password was right, but the e-mail address isn't confirmed yet (ADR-0010 §1). */
  | { ok: false; error: 'unverified' }
  /** Turned away unchecked, after repeated failures (ADR-0010 §2, clarification). */
  | { ok: false; error: 'wait'; until: Temporal.Instant };

/**
 * Signs in with an e-mail address and a password, from the IP address `address` (ADR-0010 §2).
 * Every attempt counts as a failure, under the e-mail address typed and under `address`, until it
 * turns out not to be one; after repeated failures the next attempt waits, and one made during the
 * wait is turned away without its password being checked (§2, clarification).
 */
export async function signInWithPassword(
  context: SignInContext,
  input: unknown,
  address: string,
): Promise<SignInResult> {
  const parsed = v.safeParse(passwordSignIn, input);
  // Nothing was checked, so there is nothing to count.
  if (!parsed.success) return { ok: false, error: 'incorrect' };
  const { email, password } = parsed.output;
  const emailKey = context.counterKey('sign-in:email', email);
  const addressKey = context.counterKey('sign-in:address', addressPrefix(address));
  const attempt = await countAttempt(
    context.db,
    [
      { key: emailKey, waitAfter: (failures) => waitAfter(signInWaits.email, failures) },
      { key: addressKey, waitAfter: (failures) => waitAfter(signInWaits.address, failures) },
    ],
    context.clock.now(),
    forgetFailuresAfter,
  );
  if ('waitUntil' in attempt) return { ok: false, error: 'wait', until: attempt.waitUntil };
  try {
    const { headers } = await context.auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    // Signing in clears the e-mail address's count, never the IP address's.
    await forgetCount(context.db, emailKey);
    await withdrawAttempt(context.db, attempt.counted, addressKey);
    return { ok: true, cookies: cookiesFrom(headers) };
  } catch (error) {
    if (!isAPIError(error)) throw error;
    if (error.body?.code === 'EMAIL_NOT_VERIFIED') {
      await withdrawAttempt(context.db, attempt.counted, emailKey);
      await withdrawAttempt(context.db, attempt.counted, addressKey);
      return { ok: false, error: 'unverified' };
    }
    if (error.body?.code === 'INVALID_EMAIL_OR_PASSWORD') return { ok: false, error: 'incorrect' };
    throw error;
  }
}
