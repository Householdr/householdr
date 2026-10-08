import { passkeyChallenge } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/**
 * Starts confirming it's you with a passkey (ADR-0010 §6): a challenge only the account's own
 * passkeys can sign, since the request carries its session.
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  passkeysSession(locals);
  requireSameOrigin(request, url);
  const { options, cookies: set } = await passkeyChallenge(await authContext(), request.headers);
  for (const cookie of set) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json(options);
};
