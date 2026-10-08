import { signInWithPasskey } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { requirePasskeys } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/** Signs in with the passkey that signed the challenge, and sets the new session's cookie. */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  requirePasskeys(locals);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const result = await signInWithPasskey(await authContext(), request.headers, body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json({ ok: true });
};
