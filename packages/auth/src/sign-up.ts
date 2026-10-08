import { accounts, countAllowed, verifications } from '@householdr/db';
import { and, eq, lt } from 'drizzle-orm';
import * as v from 'valibot';
import { emailAllowances, queueSignUpEmail } from './account-emails';
import { addressPrefix } from './counter-keys';
import { signUpLinkId } from './links';
import type { PasswordResetContext } from './password-reset';
import type { Client, SignInContext } from './sign-in';

/** What asking for a link to sign up needs from the app. */
export type SignUpContext = Pick<PasswordResetContext, 'db' | 'clock' | 'counterKey' | 'queue'>;

/** What the sign-up form sends (CODE-12): the address to confirm. */
export const signUpRequest = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
});

/** Sign-ups from one IP address: 10 an hour (ADR-0017 §5, clarification). */
const signUpsAllowed = { max: 10, window: Temporal.Duration.from({ hours: 1 }) };

type SignUpRequestResult =
  | { ok: true }
  | { ok: false; error: 'invalid' }
  /** Too many sign-ups came from the client's network this hour (ADR-0017 §5, clarification). */
  | { ok: false; error: 'wait' };

/**
 * Asks for a link to sign up with an e-mail address, from `client` (ADR-0010 §1, clarification).
 * Only an address without an account, within the limit on e-mails to it, gets one. The answer is
 * the same either way, so it never shows whether an address has an account (§2).
 */
export async function requestSignUp(
  context: SignUpContext,
  input: unknown,
  client: Pick<Client, 'address'>,
): Promise<SignUpRequestResult> {
  const parsed = v.safeParse(signUpRequest, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { email } = parsed.output;
  const now = context.clock.now();
  return context.db.transaction(async (tx) => {
    const fromClient = {
      key: context.counterKey('sign-ups:address', addressPrefix(client.address)),
      ...signUpsAllowed,
    };
    if (!(await countAllowed(tx, [fromClient], now))) return { ok: false, error: 'wait' } as const;
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email));
    if (account) return { ok: true } as const;
    if (await countAllowed(tx, emailAllowances(context.counterKey, email), now)) {
      await queueSignUpEmail(tx, context.queue, email);
    }
    return { ok: true } as const;
  });
}

/**
 * The address a link to sign up was sent to, if `token` is one that still works: it was never used
 * and is under 30 minutes old (ADR-0010 §1, clarification). Null otherwise.
 */
export async function signUpLinkAddress(
  context: Pick<SignInContext, 'auth' | 'clock'>,
  token: string | undefined,
): Promise<string | null> {
  if (!token || token.length > 256) return null;
  const internal = await context.auth.$context;
  const link = await internal.internalAdapter.findVerificationValue(signUpLinkId(token));
  if (!link || link.expiresAt.getTime() <= context.clock.now().epochMilliseconds) return null;
  return link.value;
}

/**
 * Deletes the links to sign up that expired 7 days ago or more, the time a pending verification is
 * kept (ADR-0012 §5, clarification).
 */
export async function deleteExpiredSignUpLinks(context: Pick<SignInContext, 'db' | 'clock'>) {
  const before = context.clock.now().subtract({ hours: 7 * 24 });
  await context.db
    .delete(verifications)
    .where(
      and(
        eq(verifications.purpose, 'sign-up'),
        lt(verifications.expiresAt, new Date(before.epochMilliseconds)),
      ),
    );
}
