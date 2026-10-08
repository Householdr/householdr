import { sessions } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { cookiesFrom, type Cookie } from './cookies';
import type { Session } from './sessions';
import type { SignInContext } from './sign-in';

/** What signing in with a passkey needs from the app. */
type PasskeySignInContext = Pick<SignInContext, 'auth' | 'db'>;

/**
 * Starts signing in with a passkey (ADR-0010 §2): a challenge for the browser to sign, which works
 * once and for five minutes, and the cookie that keeps it. With a session in `headers`, only that
 * account's passkeys can sign it.
 */
export async function passkeyChallenge(
  context: PasskeySignInContext,
  headers: Headers,
): Promise<{ options: unknown; cookies: Cookie[] }> {
  const { headers: set, response } = await context.auth.api.generatePasskeyAuthenticationOptions({
    headers,
    returnHeaders: true,
  });
  return { options: response, cookies: cookiesFrom(set) };
}

/** What the browser sends back once a passkey signed the challenge, in WebAuthn JSON (CODE-12). */
const signedChallenge = v.object({
  response: v.object({
    id: v.string(),
    rawId: v.string(),
    type: v.literal('public-key'),
    response: v.object({
      clientDataJSON: v.string(),
      authenticatorData: v.string(),
      signature: v.string(),
      userHandle: v.optional(v.string()),
    }),
    clientExtensionResults: v.record(v.string(), v.unknown()),
    authenticatorAttachment: v.optional(v.picklist(['platform', 'cross-platform'])),
  }),
});

type PasskeySignInResult =
  /** Signed in: the new session's cookie, for the response to set. */
  | { ok: true; cookies: Cookie[] }
  /** Not a passkey of this site, not the challenge it was given, or the challenge expired. */
  | { ok: false; error: 'failed' };

/** The session the library started for a signed challenge, and its cookies; null if it refused. */
async function verified(context: PasskeySignInContext, headers: Headers, input: unknown) {
  const parsed = v.safeParse(signedChallenge, input);
  if (!parsed.success) return null;
  try {
    const { headers: set, response } = await context.auth.api.verifyPasskeyAuthentication({
      headers,
      body: { response: parsed.output.response },
      returnHeaders: true,
    });
    return { session: response.session, cookies: cookiesFrom(set) };
  } catch (error) {
    if (isAPIError(error)) return null;
    throw error;
  }
}

/**
 * Signs in with the passkey that signed the challenge from `passkeyChallenge`. Unlike a password,
 * it is never slowed down, so the person whose account it is always has a way in (ADR-0010 §2,
 * clarification); and it never asks for a second factor, since a passkey is already two (§2).
 */
export async function signInWithPasskey(
  context: PasskeySignInContext,
  headers: Headers,
  input: unknown,
): Promise<PasskeySignInResult> {
  const result = await verified(context, headers, input);
  return result ? { ok: true, cookies: result.cookies } : { ok: false, error: 'failed' };
}

/**
 * Confirms it is still the person signed in to `session`, with one of the account's passkeys: the
 * new sign-in replaces the session, so it is recent again (ADR-0010 §6). Another account's passkey
 * confirms nothing, and the session the library started for it is ended at once.
 */
export async function confirmWithPasskey(
  context: PasskeySignInContext,
  session: Session,
  headers: Headers,
  input: unknown,
): Promise<PasskeySignInResult> {
  const result = await verified(context, headers, input);
  if (!result) return { ok: false, error: 'failed' };
  if (result.session.userId !== session.accountId) {
    await context.db.delete(sessions).where(eq(sessions.id, result.session.id));
    return { ok: false, error: 'failed' };
  }
  await context.db.delete(sessions).where(eq(sessions.id, session.id));
  return { ok: true, cookies: result.cookies };
}
