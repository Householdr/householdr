import { accountEmails, accounts, type AccountEmailKind, type Database } from '@householdr/db';
import { eq } from 'drizzle-orm';
import type { Auth } from './auth';
import { linkInTheMaking, type Link } from './links';

/** What preparing and finishing an account e-mail needs from the app. */
export interface AccountEmailContext {
  auth: Auth;
  db: Database;
}

/** An account e-mail, ready to be written in the recipient's language and sent. */
export interface AccountEmail {
  kind: AccountEmailKind;
  to: string;
  /** A token link, made now: only its hash is stored (ADR-0014 §7, clarification). */
  link: string;
}

/**
 * The account e-mail of the row `id`, with a fresh link that replaces any older one for the same
 * purpose (ADR-0014 §7, clarification), or null if the row is gone: sent already, or its account
 * deleted.
 */
export async function prepareAccountEmail(
  context: AccountEmailContext,
  id: string,
): Promise<AccountEmail | null> {
  const [row] = await context.db
    .select({ kind: accountEmails.kind, to: accounts.email })
    .from(accountEmails)
    .innerJoin(accounts, eq(accounts.id, accountEmails.accountId))
    .where(eq(accountEmails.id, id));
  if (!row) return null;
  const link: Link = { purpose: row.kind };
  // The reset link lasts 30 minutes and works once (ADR-0010 §8).
  await linkInTheMaking.run(link, () =>
    context.auth.api.requestPasswordReset({ body: { email: row.to } }),
  );
  if (!link.token) throw new Error('The library made no reset link.');
  return {
    kind: row.kind,
    to: row.to,
    link: `${origin(context.auth)}/reset-password/${link.token}`,
  };
}

/** Deletes the row `id` once its e-mail is sent (ADR-0014 §7, clarification). */
export async function accountEmailSent(context: AccountEmailContext, id: string) {
  await context.db.delete(accountEmails).where(eq(accountEmails.id, id));
}

/** The public URL the library was set up with. */
function origin(auth: Auth) {
  const { baseURL } = auth.options;
  if (typeof baseURL !== 'string') throw new Error('The library has no base URL.');
  return baseURL;
}
