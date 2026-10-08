import { passkeyOptions } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/**
 * Starts adding a passkey: what the browser needs to make one, in WebAuthn's JSON form. A WebAuthn
 * step needs JavaScript anyway, so it is an endpoint rather than a form action (ADR-0023 §2,
 * clarification).
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  const session = passkeysSession(locals);
  requireSameOrigin(request, url);
  const result = await passkeyOptions(await authContext(), session, request.headers);
  // The sign-in isn't recent: the page asks to confirm it's you first (ADR-0010 §6).
  if (!result.ok) return Response.json({ error: result.error }, { status: 403 });
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json(result.options);
};
