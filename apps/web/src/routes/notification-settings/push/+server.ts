import { removePushSubscription, savePushSubscription } from '@householdr/application';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { pushPublicKey } from '#lib/server/push.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import type { RequestHandler } from './$types';

/**
 * The device's context, while the settings page is released and the instance offers push
 * (CODE-20; ADR-0014 §7, clarification). Push needs JavaScript in the browser anyway, so these are
 * endpoints, like the passkey steps (CODE-13, ADR-0023 §2).
 */
async function deviceContext(locals: App.Locals, request: Request, url: URL) {
  if (!locals.flags['sign-in'] || !locals.flags['notification-preferences']) error(404);
  if (!pushPublicKey()) error(404);
  if (!locals.session) error(401);
  requireSameOrigin(request, url);
  const { db } = await authContext();
  return { db, account: locals.session.accountId, session: locals.session.id };
}

const answer = (result: { ok: true } | { ok: false; error: 'not-allowed' | 'invalid' }) => {
  if (result.ok) return Response.json({ ok: true });
  return Response.json({ error: result.error }, { status: result.error === 'invalid' ? 400 : 403 });
};

/** Turns push on for this device, with the browser's subscription (ADR-0014 §7, clarification). */
export const POST: RequestHandler = async ({ locals, request, url }) => {
  const context = await deviceContext(locals, request, url);
  const body: unknown = await request.json().catch(() => null);
  return answer(await savePushSubscription(context, body));
};

/** Turns push off for this device: forgets the browser's subscription. */
export const DELETE: RequestHandler = async ({ locals, request, url }) => {
  const context = await deviceContext(locals, request, url);
  const body: unknown = await request.json().catch(() => null);
  return answer(await removePushSubscription(context, body));
};
