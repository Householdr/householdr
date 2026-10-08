import { accounts, passkeys, type Transaction } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { createAuth } from './auth';
import { cookiesFrom, type Cookie } from './cookies';
import { deviceOf } from './device';
import { accountInTheMaking, signUpLinkId, type AccountInTheMaking } from './links';
import type { Client, SignInContext } from './sign-in';

/** The instance's own terms: where to read them, and their version (ADR-0021 §5, clarification). */
export interface Terms {
  url: string;
  version: string;
}

/** What signing up with a passkey needs from the app. */
export interface PasskeySignUpContext extends Pick<SignInContext, 'auth' | 'db' | 'clock'> {
  /** Null on an instance without terms, which asks nothing about them (ADR-0007 §2, clarification). */
  terms: Terms | null;
}

/** The new account's own details, besides its confirmed address (ADR-0010 §1). */
export interface NewAccount {
  name: string;
  /** Its holder's language and the household's country (ADR-0016 §2). */
  culture: string;
}

/**
 * What the browser needs to make the passkey of the account in the making at `email`, and the
 * cookie that keeps its challenge, which works once and for five minutes. The passkey is shown
 * under that address in the person's password manager. Nothing is stored yet but the challenge
 * (ADR-0010 §1, clarification).
 */
export async function signUpPasskeyOptions(context: PasskeySignUpContext, email: string) {
  // Without the request's cookies: the passkey is for the account in the making, whoever may be
  // signed in on this device.
  const { headers, response } = await accountInTheMaking.run({ email }, () =>
    context.auth.api.generatePasskeyRegistrationOptions({
      headers: new Headers(),
      returnHeaders: true,
    }),
  );
  return { options: response as unknown, cookies: cookiesFrom(headers) };
}

/** What the browser sends back once it has made the passkey: WebAuthn's JSON form (CODE-12). */
const newPasskey = v.object({ response: v.record(v.string(), v.unknown()) });

/** The cookie that keeps a passkey's challenge, under the library's name with our prefix. */
const challengeCookie = '__Host-householdr.better-auth-passkey';

/** Why nothing was created, thrown so that the transaction keeps nothing. */
export class NotCreated extends Error {
  constructor(readonly reason: 'expired' | 'failed') {
    super(`Not created: ${reason}`);
  }
}

type CreateAccountResult =
  /** Created and signed in: the new session's cookie, for the response to set. */
  | { ok: true; cookies: Cookie[] }
  /**
   * The sign-up link was used already, has expired, or never was one; or its address has an
   * account by now (ADR-0010 §1, clarification); or what the account joins no longer can be.
   */
  | { ok: false; error: 'expired' }
  /** Not a passkey made for the challenge this browser was given, or the challenge expired. */
  | { ok: false; error: 'failed' };

/**
 * Creates an account from the sign-up link of `token` with the passkey the browser made for the
 * challenge of `signUpPasskeyOptions` (ADR-0010 §1, §3, clarifications), and lets `joined` create
 * what the account comes with (a household, or a membership) in the same transaction: the account
 * with its confirmed address, culture and accepted terms, its passkey named after its device, its
 * session, and the link used up. On any failure, none of it is kept; `joined` throws `NotCreated`
 * to say why. The passkey is the account's first, part of creating it, so no e-mail says one was
 * added (ADR-0010 §2).
 */
export async function createAccountWithPasskey(
  context: PasskeySignUpContext,
  token: string | undefined,
  headers: Headers,
  account: NewAccount,
  input: unknown,
  client: Pick<Client, 'userAgent'>,
  joined: (tx: Transaction, accountId: string) => Promise<void>,
): Promise<CreateAccountResult> {
  if (!token || token.length > 256) return { ok: false, error: 'expired' };
  const passkey = v.safeParse(newPasskey, input);
  if (!passkey.success) return { ok: false, error: 'failed' };
  const { baseURL, secret } = context.auth.options;
  if (typeof baseURL !== 'string' || !secret)
    throw new Error('The library has no base URL or secret.');
  const termsAccepted = context.terms && {
    termsVersion: context.terms.version,
    termsAcceptedAt: new Date(context.clock.now().epochMilliseconds),
  };
  // Of the request, only the challenge's cookie: whoever may be signed in on this device has
  // nothing to do with the new account, whose session replaces theirs here.
  const challenge = (headers.get('cookie') ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${challengeCookie}=`));
  const request = new Headers({
    cookie: challenge.join('; '),
    ...(client.userAgent ? { 'user-agent': client.userAgent } : {}),
  });
  try {
    return await context.db.transaction(async (tx) => {
      // The library writes the passkey and the session through this transaction too.
      const auth = createAuth({ db: tx, baseUrl: baseURL, secret });
      const internal = await auth.$context;
      const link = await internal.internalAdapter.consumeVerificationValue(signUpLinkId(token));
      if (!link) throw new NotCreated('expired');
      // Kept in an object, which the callback below changes.
      const outcome = { taken: false };
      const inTheMaking: AccountInTheMaking = {
        email: link.value,
        write: async (id) => {
          const written = await tx
            .insert(accounts)
            .values({
              id,
              name: account.name,
              email: link.value,
              emailVerified: true,
              culture: account.culture,
              ...termsAccepted,
            })
            .onConflictDoNothing({ target: accounts.email })
            .returning({ id: accounts.id });
          outcome.taken = written.length === 0;
          return !outcome.taken;
        },
      };
      let made;
      try {
        made = await accountInTheMaking.run(inTheMaking, () =>
          auth.api.verifyPasskeyRegistration({
            headers: request,
            body: { response: passkey.output.response, createSession: true },
            returnHeaders: true,
          }),
        );
      } catch (error) {
        if (!isAPIError(error)) throw error;
        // An address that got an account in the meantime is a link that no longer works.
        throw new NotCreated(outcome.taken ? 'expired' : 'failed');
      }
      const { response, headers: set } = made;
      await tx.update(passkeys).set(deviceOf(client.userAgent)).where(eq(passkeys.id, response.id));
      await joined(tx, response.userId);
      return { ok: true, cookies: cookiesFrom(set) } as const;
    });
  } catch (error) {
    if (error instanceof NotCreated) return { ok: false, error: error.reason };
    throw error;
  }
}
