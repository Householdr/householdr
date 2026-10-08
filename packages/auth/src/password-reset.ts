import type { BreachCheck } from '@householdr/adapters';
import type { Logger } from '@householdr/application';
import { accounts, countAllowed, forgetCount, type JobQueue } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { emailAllowances, queueAccountEmail } from './account-emails';
import { passwordResetInTheMaking } from './links';
import type { SignInContext } from './sign-in';

/** What resetting a password needs from the app. */
export interface PasswordResetContext extends SignInContext {
  queue: JobQueue;
  logger: Logger;
  /** Checks a new password against known breaches; absent where the check is off (ADR-0010 §2). */
  checkBreach?: (password: string) => Promise<BreachCheck>;
}

/** What the form asking for a reset link sends (CODE-12). */
export const passwordResetRequest = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
});

/**
 * Asks for a link to choose a new password (ADR-0010 §8). Only an address with an account, within
 * the limit on e-mails to it, gets one; the answer is the same either way, so it never shows
 * whether an address has an account (§2; ADR-0017 §5, clarification).
 */
export async function requestPasswordReset(
  context: PasswordResetContext,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'invalid' }> {
  const parsed = v.safeParse(passwordResetRequest, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { email } = parsed.output;
  await context.db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email));
    if (!account) return;
    const allowances = emailAllowances(context.counterKey, email);
    if (!(await countAllowed(tx, allowances, context.clock.now()))) return;
    await queueAccountEmail(tx, context.queue, account.id, 'password-reset');
  });
  return { ok: true };
}

/**
 * Whether `token` is a reset link's that still works: it was never used and is under 30 minutes
 * old (ADR-0010 §8). A page can then say so before a new password is typed.
 */
export async function resetLinkWorks(
  context: Pick<SignInContext, 'auth' | 'clock'>,
  token: string | undefined,
): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const internal = await context.auth.$context;
  const link = await internal.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return link !== null && link.expiresAt.getTime() > context.clock.now().epochMilliseconds;
}

export type NewPasswordResult =
  | { ok: true }
  /** At least 12 characters and at most 128 (ADR-0010 §2). */
  | { ok: false; error: 'too-short' | 'too-long' }
  /** In a known breach (ADR-0010 §2). */
  | { ok: false; error: 'breached' }
  /** The link was used already, has expired, or never was one. */
  | { ok: false; error: 'expired' };

/**
 * Sets a new password with the token of a reset link (ADR-0010 §8). It ends every session of the
 * account, forgets the failed sign-ins of its e-mail address and the wrong codes of the account
 * (§2, clarification), and e-mails the member that the password was changed.
 */
export async function setNewPassword(
  context: PasswordResetContext,
  input: { token?: unknown; password?: unknown },
): Promise<NewPasswordResult> {
  const token = typeof input.token === 'string' ? input.token : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (token.length === 0 || token.length > 256) return { ok: false, error: 'expired' };
  // In UTF-16 units, as the form's limits, sign-in and the library count, so they all agree.
  if (password.length < 12) return { ok: false, error: 'too-short' };
  if (password.length > 128) return { ok: false, error: 'too-long' };
  if (context.checkBreach) {
    const breach = await context.checkBreach(password);
    if (breach === 'breached') return { ok: false, error: 'breached' };
    // Unchecked, a password is accepted; the miss is logged with nothing about whose it is
    // (ADR-0010 §2, clarification).
    if (breach === 'unknown') context.logger.warn('password.breach-check-missed');
  }
  const reset: { account?: { id: string; email: string } } = {};
  try {
    await passwordResetInTheMaking.run(reset, () =>
      context.auth.api.resetPassword({ body: { token, newPassword: password } }),
    );
  } catch (error) {
    if (isAPIError(error) && ['INVALID_TOKEN', 'USER_NOT_FOUND'].includes(error.body?.code ?? '')) {
      return { ok: false, error: 'expired' };
    }
    throw error;
  }
  const { account } = reset;
  if (!account) throw new Error('The library reset no password.');
  await forgetCount(context.db, context.counterKey('sign-in:email', account.email));
  await forgetCount(context.db, context.counterKey('sign-in:account', account.id));
  await context.db.transaction((tx) =>
    queueAccountEmail(tx, context.queue, account.id, 'password-changed'),
  );
  return { ok: true };
}
