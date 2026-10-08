import { createHouseholdWithPasskey } from '@householdr/auth';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { RequestHandler } from './$types';

/**
 * Creates the household, its head's account and the passkey the browser made for the challenge
 * it was given, and signs in with the new session (ADR-0007 §2, ADR-0010 §1, §3).
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  // There while its release flag is on (CODE-20).
  if (!locals.flags.onboarding) error(404);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const result = await createHouseholdWithPasskey(
    await authContext(),
    cookies.get(signUpCookie.name),
    request.headers,
    body,
    { userAgent: request.headers.get('user-agent') },
  );
  if (!result.ok) {
    const fields = result.error === 'invalid' ? { fields: result.fields } : {};
    return Response.json({ error: result.error, ...fields }, { status: 400 });
  }
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  // The link is used up (ADR-0010 §1, clarification).
  cookies.delete(signUpCookie.name, signUpCookie.options);
  return Response.json({ ok: true });
};
