import { accounts, countAllowed, countAttempt, forgetCount, withdrawAttempt } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { parseCookies } from 'better-auth/cookies';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { cookiesFrom, type Cookie } from './cookies';
import type { SignInContext } from './sign-in';
import { forgetFailuresAfter, signInWaits, waitAfter } from './waits';

/**
 * The cookie of the step between a right password and a code, which the library sets and signs:
 * `identifier.signature`, the identifier a random one it keeps, hashed (SEC-7), for 10 minutes.
 */
const stepCookie = '__Host-householdr.two_factor';

const spaces = /\s/g;
const spacesAndHyphens = /[\s-]/g;

/** A code from an authenticator app: six digits, which apps often show in two groups (CODE-12). */
export const appCode = v.pipe(
  v.string(),
  v.maxLength(20),
  v.transform((code) => code.replace(spaces, '')),
  v.regex(/^\d{6}$/),
);

/**
 * A recovery code, `abcde-12345`, however it is typed: in capitals, or without its hyphen
 * (UI-14). They are made of lower-case letters and digits only.
 */
const recoveryCode = v.pipe(
  v.string(),
  v.maxLength(30),
  v.transform((code) => code.replace(spacesAndHyphens, '').toLowerCase()),
  v.regex(/^[a-z0-9]{10}$/),
  v.transform((code) => `${code.slice(0, 5)}-${code.slice(5)}`),
);

/** What the forms after a right password send: a code from the app, or a recovery code. */
const codeInput = v.union([v.object({ code: appCode }), v.object({ recoveryCode })]);

/**
 * How long a code from the app is refused after it was used: the library takes the codes of the
 * step before and after the current one too, so a code works for at most 90 seconds.
 */
const usedCodeRemembered = Temporal.Duration.from({ minutes: 2 });

export type CodeResult =
  /** Signed in: the new session's cookie, and the step's cookie cleared. */
  | { ok: true; cookies: Cookie[] }
  /** The code is wrong, used already, or not a code at all. */
  | { ok: false; error: 'incorrect' }
  /** No step waits for a code: it is over 10 minutes old, is used up, or never was. */
  | { ok: false; error: 'expired' }
  /** Turned away unchecked, after repeated wrong codes (ADR-0010 §2, clarification). */
  | { ok: false; error: 'wait'; until: Temporal.Instant };

/** Whether the account has two-factor on, so a password alone doesn't sign in to it. */
export async function twoFactorOn(context: Pick<SignInContext, 'db'>, accountId: string) {
  const [account] = await context.db
    .select({ on: accounts.twoFactorEnabled })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  return account?.on ?? false;
}

/** The step's cookie among `headers`, as the library signed it; empty if there is none. */
const stepOf = (headers: Headers) =>
  parseCookies(headers.get('cookie') ?? '').get(stepCookie) ?? '';

/**
 * The account whose step the request's cookie carries, if any. Only the identifier is looked up,
 * without its signature: guessing one is as hopeless as guessing a session, and the library checks
 * the signature before it accepts a code.
 */
async function stepAccount(context: Pick<SignInContext, 'auth'>, headers: Headers) {
  const signed = stepOf(headers);
  const identifier = signed.slice(0, Math.max(signed.lastIndexOf('.'), 0));
  if (!identifier) return null;
  const internal = await context.auth.$context;
  const step = await internal.internalAdapter.findVerificationValue(identifier);
  return step?.value ?? null;
}

/**
 * Whether the request carries a step that waits for a code, so the page that asks for one has
 * something to ask it for.
 */
export async function codeAwaited(context: Pick<SignInContext, 'auth'>, headers: Headers) {
  return (await stepAccount(context, headers)) !== null;
}

/**
 * Finishes signing in after a right password with a code from the account's authenticator app, or
 * one of its recovery codes, each of which works once (ADR-0010 §2). Wrong codes are counted per
 * account, under the same waits as passwords but with 15 minutes as the longest; an attempt during
 * a wait is turned away unchecked (§2, clarification). Of the request, only the step's cookie and
 * the user agent are passed on, so a session already on this device can't stand in for the step.
 */
export async function signInWithCode(
  context: SignInContext,
  headers: Headers,
  input: unknown,
): Promise<CodeResult> {
  const parsed = v.safeParse(codeInput, input);
  // Nothing was checked, so there is nothing to count.
  if (!parsed.success) return { ok: false, error: 'incorrect' };
  const accountId = await stepAccount(context, headers);
  if (!accountId) return { ok: false, error: 'expired' };
  const accountKey = context.counterKey('sign-in:account', accountId);
  const now = context.clock.now();
  const attempt = await countAttempt(
    context.db,
    [{ key: accountKey, waitAfter: (failures) => waitAfter(signInWaits.account, failures) }],
    now,
    forgetFailuresAfter,
  );
  if ('waitUntil' in attempt) return { ok: false, error: 'wait', until: attempt.waitUntil };
  const step = new Headers({ cookie: `${stepCookie}=${encodeURIComponent(stepOf(headers))}` });
  const userAgent = headers.get('user-agent');
  if (userAgent) step.set('user-agent', userAgent);
  // A code from the app works once: it is marked used before it is checked, so two requests can't
  // both sign in with it, and unmarked if it turns out wrong.
  let used: string | undefined;
  if ('code' in parsed.output) {
    used = context.counterKey('two-factor:code', `${accountId}\n${parsed.output.code}`);
    const fresh = [{ key: used, max: 1, window: usedCodeRemembered }];
    if (!(await countAllowed(context.db, fresh, now))) return { ok: false, error: 'incorrect' };
  }
  try {
    const { headers: set, response } =
      'code' in parsed.output
        ? await context.auth.api.verifyTOTP({
            body: { code: parsed.output.code },
            headers: step,
            returnHeaders: true,
          })
        : await context.auth.api.verifyBackupCode({
            body: { code: parsed.output.recoveryCode },
            headers: step,
            returnHeaders: true,
          });
    // Signing in clears the counts of the account and of its e-mail address (§2, clarification).
    await forgetCount(context.db, accountKey);
    await forgetCount(context.db, context.counterKey('sign-in:email', response.user.email));
    return { ok: true, cookies: cookiesFrom(set) };
  } catch (error) {
    if (!isAPIError(error)) throw error;
    if (used) await forgetCount(context.db, used);
    const code = error.body?.code ?? '';
    if (['INVALID_CODE', 'INVALID_BACKUP_CODE'].includes(code)) {
      return { ok: false, error: 'incorrect' };
    }
    // The step is gone, so no code was checked, and nothing is counted.
    await withdrawAttempt(context.db, attempt.counted, accountKey);
    if (
      [
        'INVALID_TWO_FACTOR_COOKIE',
        'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
        'TOTP_NOT_ENABLED',
        'BACKUP_CODES_NOT_ENABLED',
      ].includes(code)
    ) {
      return { ok: false, error: 'expired' };
    }
    throw error;
  }
}
