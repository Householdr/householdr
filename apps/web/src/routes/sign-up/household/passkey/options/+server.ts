import { householdPasskeyOptions } from '@householdr/auth';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { RequestHandler } from './$types';

/**
 * Starts creating the household of the first step of onboarding (ADR-0007 §2): once its fields
 * are valid, what the browser needs to make the new account's passkey, in WebAuthn's JSON form. A
 * WebAuthn step needs JavaScript anyway, so it is an endpoint rather than a form action (ADR-0023
 * §2, clarification).
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  // There while its release flag is on (CODE-20).
  if (!locals.flags.onboarding) error(404);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const token = cookies.get(signUpCookie.name);
  const result = await householdPasskeyOptions(await authContext(), token, body);
  if (!result.ok) {
    const fields = result.error === 'invalid' ? { fields: result.fields } : {};
    return Response.json({ error: result.error, ...fields }, { status: 400 });
  }
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  return Response.json(result.options);
};
