import { mayTurnOffTwoFactor } from '@householdr/application';
import { accounts, credentials, twoFactors } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as v from 'valibot';
import { queueAccountEmail } from './account-emails';
import type { Auth } from './auth';
import { cookiesFrom, type Cookie } from './cookies';
import { signedInRecently, type PasskeysContext } from './passkeys';
import { currentSession, type Session } from './sessions';
import { appCode, twoFactorOn } from './two-factor-sign-in';

/**
 * What turning two-factor on and off needs from the app: the same as changing passkeys, which
 * need a recent sign-in too (ADR-0010 §6).
 */
export type TwoFactorContext = PasskeysContext;

/** What the authenticator app is set up with: a QR code of `uri`, or `key` typed in. */
export interface TwoFactorSetup {
  /** An `otpauth://` URI, with the secret in it. */
  uri: string;
  /** The secret, in the base-32 form apps take. */
  key: string;
}

/** The name apps show the account under, with its e-mail address. */
const issuer = 'Householdr';

/** RFC 4648's base-32 alphabet, which `otpauth://` URIs and apps use for secrets. */
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array) {
  let text = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += base32Alphabet.charAt((value >>> bits) & 31);
    }
  }
  if (bits > 0) text += base32Alphabet.charAt((value << (5 - bits)) & 31);
  return text;
}

/**
 * The app's setup for `secret`, as the library would make it: six digits every 30 seconds,
 * under the account's e-mail address.
 */
function setupFor(secret: string, email: string): TwoFactorSetup {
  const key = base32(new TextEncoder().encode(secret));
  const query = new URLSearchParams({ secret: key, issuer, digits: '6', period: '30' });
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return { uri: `otpauth://totp/${label}?${query.toString()}`, key };
}

/** Ten recovery codes such as `k3x9a-p2m7q`: lower-case letters and digits, easy to type. */
const newRecoveryCodes = () =>
  Array.from({ length: 10 }, () => {
    const code = generateRandomString(10, 'a-z', '0-9');
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });

/**
 * Encrypts `data` as the library's two-factor plugin does, with the current TOTP key (ADR-0017
 * §7), so the plugin can read it back.
 */
async function encrypt(auth: Auth, data: string) {
  const { secretConfig } = await auth.$context;
  return symmetricEncrypt({ key: secretConfig, data });
}

/** The account's e-mail address and whether it has a password: two-factor is for those only. */
async function accountOf(context: Pick<TwoFactorContext, 'db'>, session: Session) {
  const [account] = await context.db
    .select({ email: accounts.email, on: accounts.twoFactorEnabled })
    .from(accounts)
    .where(eq(accounts.id, session.accountId));
  if (!account) throw new Error('A session without an account.');
  const [password] = await context.db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, session.accountId), isNotNull(credentials.password)))
    .limit(1);
  return { ...account, password: password !== undefined };
}

/**
 * The account's two-factor, as the security page shows it, or null for an account without a
 * password: its passkeys are two factors already, so it is offered nothing (ADR-0010 §2).
 */
export async function accountTwoFactor(
  context: Pick<TwoFactorContext, 'db'>,
  session: Session,
): Promise<{ on: boolean } | null> {
  const account = await accountOf(context, session);
  return account.password ? { on: account.on } : null;
}

type StartResult =
  | { ok: true; setup: TwoFactorSetup }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** Only an account with a password, and two-factor off, can turn it on. */
  | { ok: false; error: 'unavailable' };

/**
 * Starts turning two-factor on: a new secret for an authenticator app, kept encrypted and unused
 * until a code from the app shows it was set up right (`finishTwoFactor`). Starting again replaces
 * a setup that was never finished.
 */
export async function startTwoFactor(
  context: TwoFactorContext,
  session: Session,
): Promise<StartResult> {
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  const account = await accountOf(context, session);
  if (!account.password || account.on) return { ok: false, error: 'unavailable' };
  // As long and as random as the library's own.
  const secret = generateRandomString(32);
  const row = {
    secret: await encrypt(context.auth, secret),
    // The recovery codes come once the setup is finished.
    backupCodes: await encrypt(context.auth, '[]'),
    verified: false,
  };
  await context.db
    .insert(twoFactors)
    .values({ userId: session.accountId, ...row })
    .onConflictDoUpdate({ target: twoFactors.userId, set: { ...row, updatedAt: new Date() } });
  return { ok: true, setup: setupFor(secret, account.email) };
}

/** The setup started for the account and not finished yet, if there is one. */
async function unfinishedSetup(context: TwoFactorContext, session: Session) {
  const [row] = await context.db
    .select({ secret: twoFactors.secret, email: accounts.email })
    .from(twoFactors)
    .innerJoin(accounts, eq(accounts.id, twoFactors.userId))
    .where(and(eq(twoFactors.userId, session.accountId), eq(twoFactors.verified, false)));
  if (!row) return null;
  const { secretConfig } = await context.auth.$context;
  return setupFor(await symmetricDecrypt({ key: secretConfig, data: row.secret }), row.email);
}

type FinishResult =
  /** On: the recovery codes, shown this once, and the session that replaced this one, with its cookie. */
  | { ok: true; recoveryCodes: string[]; session: Session; cookies: Cookie[] }
  /** The code isn't the app's: the setup, to try again. */
  | { ok: false; error: 'incorrect'; setup: TwoFactorSetup }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** No setup waits to be finished. */
  | { ok: false; error: 'not-started' };

/**
 * Finishes turning two-factor on with a code from the app that was set up, which the library
 * checks: from then on, a password sign-in asks for a code too, and the library starts a new
 * session in place of this one. It makes ten recovery codes, shown this once, and e-mails the
 * member that two-factor was turned on (ADR-0010 §2, ADR-0014 §2).
 */
export async function finishTwoFactor(
  context: TwoFactorContext,
  session: Session,
  headers: Headers,
  input: { code?: unknown },
): Promise<FinishResult> {
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  const setup = await unfinishedSetup(context, session);
  if (!setup) return { ok: false, error: 'not-started' };
  const code = v.safeParse(appCode, input.code);
  if (!code.success) return { ok: false, error: 'incorrect', setup };
  let set: Headers;
  try {
    ({ headers: set } = await context.auth.api.verifyTOTP({
      body: { code: code.output },
      headers,
      returnHeaders: true,
    }));
  } catch (error) {
    if (isAPIError(error) && error.body?.code === 'INVALID_CODE') {
      return { ok: false, error: 'incorrect', setup };
    }
    throw error;
  }
  const cookies = cookiesFrom(set);
  const replaced = await currentSession(
    context.auth,
    new Headers({
      cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    }),
  );
  if (!replaced.session) throw new Error('The library started no session in place of this one.');
  const recoveryCodes = newRecoveryCodes();
  const backupCodes = await encrypt(context.auth, JSON.stringify(recoveryCodes));
  await context.db.transaction(async (tx) => {
    await tx
      .update(twoFactors)
      .set({ backupCodes, updatedAt: new Date() })
      .where(eq(twoFactors.userId, session.accountId));
    await queueAccountEmail(tx, context.queue, session.accountId, 'two-factor-on');
  });
  return { ok: true, recoveryCodes, session: replaced.session, cookies };
}

type TurnOffResult =
  | { ok: true }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** A head without a passkey keeps it on, to keep two factors (ADR-0010 §3). */
  | { ok: false; error: 'head' };

/**
 * Turns two-factor off: a password signs in on its own again, the secret and recovery codes are
 * deleted, and the member is e-mailed, in one change (ADR-0010 §2, ADR-0014 §2, §7). A head
 * without a passkey is refused, since their account must keep two factors (§3).
 */
export async function turnOffTwoFactor(
  context: TwoFactorContext,
  session: Session,
): Promise<TurnOffResult> {
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  // Already off: nothing changes, and nobody is e-mailed again.
  if (!(await twoFactorOn(context, session.accountId))) return { ok: true };
  if (!(await mayTurnOffTwoFactor(context, session.accountId))) {
    return { ok: false, error: 'head' };
  }
  await context.db.transaction(async (tx) => {
    await tx.delete(twoFactors).where(eq(twoFactors.userId, session.accountId));
    await tx
      .update(accounts)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(accounts.id, session.accountId));
    await queueAccountEmail(tx, context.queue, session.accountId, 'two-factor-off');
  });
  return { ok: true };
}

type RecoveryCodesResult =
  /** The new codes, shown this once; the old ones no longer work. */
  | { ok: true; recoveryCodes: string[] }
  /** The sign-in isn't recent: the person confirms it is them first (ADR-0010 §6). */
  | { ok: false; error: 'confirm' }
  /** Two-factor is off, so there are no recovery codes to replace. */
  | { ok: false; error: 'off' };

/**
 * Replaces the recovery codes with ten new ones, shown this once, and e-mails the member that
 * they changed, in one change (ADR-0010 §2, ADR-0014 §2, §7).
 */
export async function replaceRecoveryCodes(
  context: TwoFactorContext,
  session: Session,
): Promise<RecoveryCodesResult> {
  if (!(await signedInRecently(context, session))) return { ok: false, error: 'confirm' };
  const recoveryCodes = newRecoveryCodes();
  const backupCodes = await encrypt(context.auth, JSON.stringify(recoveryCodes));
  return context.db.transaction(async (tx) => {
    const replaced = await tx
      .update(twoFactors)
      .set({ backupCodes, updatedAt: new Date() })
      .where(and(eq(twoFactors.userId, session.accountId), eq(twoFactors.verified, true)))
      .returning({ id: twoFactors.id });
    if (replaced.length === 0) return { ok: false, error: 'off' } as const;
    await queueAccountEmail(tx, context.queue, session.accountId, 'recovery-codes-changed');
    return { ok: true, recoveryCodes } as const;
  });
}
