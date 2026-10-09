import { randomBytes } from 'node:crypto';
import {
  accountEmails,
  accounts,
  queueJob,
  type AccountEmailKind,
  type Database,
  type JobQueue,
  type LinkKind,
  type Transaction,
} from '@householdr/db';
import { eq } from 'drizzle-orm';
import type { Auth } from './auth';
import type { CounterKey } from './counter-keys';
import { linkInTheMaking, signUpLinkId, type Link } from './links';

/** What preparing and finishing an account e-mail needs from the app. */
export interface AccountEmailContext {
  auth: Auth;
  db: Database;
}

/** An account e-mail, ready to be written in the recipient's language and sent. */
export type AccountEmail =
  | {
      /** A link to sign up (ADR-0010 §1, clarification), or to choose a new password (§8). */
      kind: LinkKind;
      to: string;
      /** A token link, made now: only its hash is stored (ADR-0014 §7, clarification). */
      link: string;
    }
  /**
   * A notice that a way of signing in changed: the password, which every recovery sends
   * (ADR-0010 §8), a passkey, two-factor or its recovery codes (§2).
   */
  | { kind: Exclude<AccountEmailKind, LinkKind>; to: string };

/**
 * E-mails to one address: 3 an hour and 12 a day, verification, reset and invitation e-mails
 * counted together (ADR-0017 §5, clarification).
 */
export const emailAllowances = (counterKey: CounterKey, email: string) => [
  { key: counterKey('emails:hour', email), max: 3, window: Temporal.Duration.from({ hours: 1 }) },
  { key: counterKey('emails:day', email), max: 12, window: Temporal.Duration.from({ hours: 24 }) },
];

/** Writes the row of an account e-mail inside `tx`, and queues the job that sends it. */
async function queueEmail(
  tx: Transaction,
  queue: JobQueue,
  row: typeof accountEmails.$inferInsert,
) {
  const [written] = await tx.insert(accountEmails).values(row).returning({ id: accountEmails.id });
  if (!written) throw new Error('No account e-mail was written.');
  await queueJob(queue, tx, 'account-email', { id: written.id });
  return written.id;
}

/** Queues an account e-mail to `accountId` inside `tx` (ADR-0014 §7, clarification). */
export function queueAccountEmail(
  tx: Transaction,
  queue: JobQueue,
  accountId: string,
  kind: Exclude<AccountEmailKind, 'sign-up'>,
) {
  return queueEmail(tx, queue, { kind, accountId });
}

/**
 * Queues the e-mail with a link to sign up to `email`, which has no account, inside `tx`
 * (ADR-0010 §1, clarification).
 */
export function queueSignUpEmail(tx: Transaction, queue: JobQueue, email: string) {
  return queueEmail(tx, queue, { kind: 'sign-up', email });
}

/**
 * The account e-mail of the row `id`, with a fresh link that replaces any older one for the same
 * purpose (ADR-0014 §7, clarification), or null if there is none to send: the row is gone, sent
 * already or with its account, or the sign-up's address has an account by now.
 */
export async function prepareAccountEmail(
  context: AccountEmailContext,
  id: string,
): Promise<AccountEmail | null> {
  const [row] = await context.db
    .select({ kind: accountEmails.kind, address: accountEmails.email, to: accounts.email })
    .from(accountEmails)
    .leftJoin(accounts, eq(accounts.id, accountEmails.accountId))
    .where(eq(accountEmails.id, id));
  if (!row) return null;
  const { kind, address, to } = row;
  if (kind === 'sign-up') return address ? signUpEmail(context, id, address) : null;
  if (!to) return null;
  if (kind !== 'password-reset') return { kind, to };
  const link: Link = { purpose: kind };
  // The reset link lasts 30 minutes and works once (ADR-0010 §8).
  await linkInTheMaking.run(link, () =>
    context.auth.api.requestPasswordReset({ body: { email: to } }),
  );
  if (!link.token) throw new Error('The library made no reset link.');
  return { kind, to, link: `${origin(context.auth)}/reset-password/${link.token}` };
}

/** How long a link to sign up works, from when it is sent (ADR-0010 §1, clarification). */
const signUpLinkLifetime = Temporal.Duration.from({ minutes: 30 });

/**
 * The e-mail with a link to sign up as `email`, made now. An address that has an account by now
 * gets none, so its row goes (ADR-0010 §1, clarification).
 */
async function signUpEmail(
  context: AccountEmailContext,
  id: string,
  email: string,
): Promise<AccountEmail | null> {
  const [account] = await context.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (account) {
    await accountEmailSent(context, id);
    return null;
  }
  const token = randomBytes(32).toString('base64url');
  const internal = await context.auth.$context;
  const expiresAt = Temporal.Now.instant().add(signUpLinkLifetime);
  await linkInTheMaking.run({ purpose: 'sign-up' }, () =>
    internal.internalAdapter.createVerificationValue({
      identifier: signUpLinkId(token),
      value: email,
      expiresAt: new Date(expiresAt.epochMilliseconds),
    }),
  );
  return { kind: 'sign-up', to: email, link: `${origin(context.auth)}/sign-up/${token}` };
}

/** Deletes the row `id` once its e-mail is sent, or has none to send (ADR-0014 §7, clarification). */
export async function accountEmailSent(context: AccountEmailContext, id: string) {
  await context.db.delete(accountEmails).where(eq(accountEmails.id, id));
}

/** The public URL the library was set up with. */
function origin(auth: Auth) {
  const { baseURL } = auth.options;
  if (typeof baseURL !== 'string') throw new Error('The library has no base URL.');
  return baseURL;
}
