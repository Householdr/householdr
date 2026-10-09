import { joinWithPasskey } from '@householdr/auth';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { invitationCookie } from '#lib/server/invitation-link.js';
import { requireSameOrigin } from '#lib/server/same-origin.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { RequestHandler } from './$types';

/**
 * Creates the account with the passkey the browser made for the challenge it was given, joins the
 * household as the invited profile, and signs in with the new session (ADR-0010 §1, §5).
 */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
  // There while onboarding's release flag is on (CODE-20).
  if (!locals.flags.onboarding) error(404);
  requireSameOrigin(request, url);
  const body: unknown = await request.json().catch(() => null);
  const result = await joinWithPasskey(
    await authContext(),
    cookies.get(signUpCookie.name),
    cookies.get(invitationCookie.name),
    request.headers,
    body,
    { userAgent: request.headers.get('user-agent') },
  );
  if (!result.ok) {
    const fields = result.error === 'invalid' ? { fields: result.fields } : {};
    return Response.json({ error: result.error, ...fields }, { status: 400 });
  }
  for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
  // Both links are used up (ADR-0010 §1, §5).
  cookies.delete(signUpCookie.name, signUpCookie.options);
  cookies.delete(invitationCookie.name, invitationCookie.options);
  return Response.json({ household: result.householdId });
};
