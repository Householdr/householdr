import { addPasskey } from '@householdr/auth';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/** Adds the passkey the browser made for the challenge it was given (ADR-0010 §2). */
export const POST: RequestHandler = async ({ locals, request, url, getClientAddress }) => {
  const session = passkeysSession(locals);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const result = await addPasskey(await authContext(), session, request.headers, body, {
    address: getClientAddress(),
    userAgent: request.headers.get('user-agent'),
  });
  if (result.ok) return Response.json({ ok: true });
  return Response.json({ error: result.error }, { status: result.error === 'confirm' ? 403 : 400 });
};
