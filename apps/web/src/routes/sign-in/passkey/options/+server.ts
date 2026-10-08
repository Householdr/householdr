import { passkeyChallenge } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { requirePasskeys } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/**
 * Starts signing in with a passkey: a challenge any passkey of this site can sign, in WebAuthn's
 * JSON form (ADR-0010 §2). A WebAuthn step needs JavaScript anyway, so it is an endpoint rather
 * than a form action (ADR-0023 §2, clarification).
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  requirePasskeys(locals);
  requireSameOrigin(request, url);
  // Without the request's cookies: whoever is signing in isn't known yet.
  const { options, cookies: set } = await passkeyChallenge(await authContext(), new Headers());
  for (const cookie of set) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json(options);
};
