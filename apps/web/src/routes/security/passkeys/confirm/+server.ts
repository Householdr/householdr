import { confirmWithPasskey } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/** Confirms it's you with the passkey that signed the challenge: a new session replaces this one. */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  const session = passkeysSession(locals);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const result = await confirmWithPasskey(await authContext(), session, request.headers, body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json({ ok: true });
};
