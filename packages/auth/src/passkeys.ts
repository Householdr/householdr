import { accounts, passkeys, sessions } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { queueAccountEmail } from './account-emails';
import { recentSignIn } from './auth';
import { cookiesFrom, type Cookie } from './cookies';
import { deviceOf } from './device';
import type { PasswordResetContext } from './password-reset';
import type { Session } from './sessions';
import { signInWithPassword, type Client, type SignInResult } from './sign-in';

/** What adding and removing passkeys needs from the app: signing in, and the job queue. */
export type PasskeysContext = Omit<PasswordResetContext, 'checkBreach'>;

/** A passkey of the account, as the security page lists it (ADR-0010 §2). */
interface Passkey {
  id: string;
  /** The browser and operating system it was added on, by name; null when unknown. */
  browser: string | null;
  system: string | null;
  addedAt: Temporal.Instant;
}

/** The account's passkeys, the most recently added first. */
export async function accountPasskeys(
  context: Pick<PasskeysContext, 'db'>,
  session: Session,
): Promise<Passkey[]> {
  const rows = await context.db
    .select({
      id: passkeys.id,
      browser: passkeys.browser,
      system: passkeys.system,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, session.accountId));
  return rows
    .map(({ createdAt, ...row }) => ({
      ...row,
      addedAt: Temporal.Instant.fromEpochMilliseconds(createdAt.getTime()),
    }))
    .sort((a, b) => Temporal.Instant.compare(b.addedAt, a.addedAt));
}

/**
 * Whether the session was signed in to recently enough to change a way of signing in; if not, the
 * person confirms it is them first (ADR-0010 §6).
 */
export async function signedInRecently(
  context: Pick<PasskeysContext, 'db' | 'clock'>,
  session: Session,
): Promise<boolean> {
  const [row] = await context.db
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.id, session.id));
  if (!row) return false;
  const signedInAt = Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime());
  return Temporal.Duration.compare(context.clock.now().since(signedInAt), recentSignIn) < 0;
}

/** The e-mail address of the session's account. */
async function emailOf(context: Pick<PasskeysContext, 'db'>, session: Session) {
  const [account] = await context.db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, session.accountId));
  if (!account) throw new Error('A session without an account.');
  return account.email;
}

/**
 * Confirms it is still the person signed in to `session`, with their password: a new sign-in
 * replaces the session, so it is recent again (ADR-0010 §6). Failures count as sign-in failures
 * do (§2, clarification).
 */
export async function confirmWithPassword(
  context: PasskeysContext,
  session: Session,
  input: { password?: unknown },
  client: Client,
): Promise<SignInResult> {
  const result = await signInWithPassword(
    context,
    { email: await emailOf(context, session), password: input.password },
    client,
  );
  if (result.ok) await context.db.delete(sessions).where(eq(sessions.id, session.id));
  return result;
}

type PasskeyOptionsResult =
  /** What the browser needs to make a passkey, and the cookie that keeps its challenge. */
  | { ok: true; options: unknown; cookies: Cookie[] }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' };

/**
 * Starts adding a passkey to the account of the session the request `headers` carry: a
 * challenge for the browser to sign, which works once and for five minutes. The passkey is shown
 * under the account's e-mail address in the person's password manager.
 */
export async function passkeyOptions(
  context: Pick<PasskeysContext, 'auth' | 'db' | 'clock'>,
  session: Session,
  headers: Headers,
): Promise<PasskeyOptionsResult> {
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  const email = await emailOf(context, session);
  const { headers: set, response } = await context.auth.api.generatePasskeyRegistrationOptions({
    headers,
    query: { name: email },
    returnHeaders: true,
  });
  return { ok: true, options: response, cookies: cookiesFrom(set) };
}

/** What the browser sends back once it has made a passkey: WebAuthn's JSON form (CODE-12). */
const newPasskey = v.object({ response: v.record(v.string(), v.unknown()) });

type AddPasskeyResult =
  | { ok: true }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** Not a passkey made for the challenge this session was given, or the challenge expired. */
  | { ok: false; error: 'failed' };

/**
 * Adds the passkey the browser made to the session's account, named after the device it was
 * added on, and e-mails the member that a passkey was added (ADR-0010 §2, ADR-0014 §2).
 */
export async function addPasskey(
  context: PasskeysContext,
  session: Session,
  headers: Headers,
  input: unknown,
  client: Client,
): Promise<AddPasskeyResult> {
  const parsed = v.safeParse(newPasskey, input);
  if (!parsed.success) return { ok: false, error: 'failed' };
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  let added: { id: string };
  try {
    added = await context.auth.api.verifyPasskeyRegistration({
      headers,
      body: { response: parsed.output.response },
    });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    return { ok: false, error: 'failed' };
  }
  await context.db.transaction(async (tx) => {
    await tx
      .update(passkeys)
      .set(deviceOf(client.userAgent))
      .where(and(eq(passkeys.id, added.id), eq(passkeys.userId, session.accountId)));
    await queueAccountEmail(tx, context.queue, session.accountId, 'passkey-added');
  });
  return { ok: true };
}

/** What the form to remove a passkey sends (CODE-12). */
const passkeyToRemove = v.object({ passkey: v.pipe(v.string(), v.uuid()) });

type RemovePasskeyResult =
  | { ok: true }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** Not a passkey of this account, or one already removed. */
  | { ok: false; error: 'not-found' };

/**
 * Removes one of the account's passkeys, and e-mails the member that it was removed, in the same
 * transaction (ADR-0010 §2, ADR-0014 §7).
 */
export async function removePasskey(
  context: PasskeysContext,
  session: Session,
  input: unknown,
): Promise<RemovePasskeyResult> {
  const parsed = v.safeParse(passkeyToRemove, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  return context.db.transaction(async (tx) => {
    const removed = await tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, parsed.output.passkey), eq(passkeys.userId, session.accountId)))
      .returning({ id: passkeys.id });
    if (removed.length === 0) return { ok: false, error: 'not-found' } as const;
    await queueAccountEmail(tx, context.queue, session.accountId, 'passkey-removed');
    return { ok: true } as const;
  });
}
