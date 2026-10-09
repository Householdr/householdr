import { openInvitation } from '@householdr/application';
import { error, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { invitationCookie } from '#lib/server/invitation-link.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { RequestHandler } from './$types';

/**
 * The link from a sign-up e-mail. Its token moves into a cookie and out of the address bar at once,
 * so it can't stay in the history or leak in a referrer (ADR-0017 §4). Someone who opened an
 * invitation in this browser goes on to joining with their new account, everyone else to creating
 * a household: the two ways in (ADR-0010 §1).
 */
export const GET: RequestHandler = async ({ locals, params, cookies }) => {
  if (!locals.flags.onboarding) error(404);
  cookies.set(signUpCookie.name, params.token, signUpCookie.options);
  const invited = await openInvitation(await authContext(), cookies.get(invitationCookie.name));
  redirect(303, invited ? '/invitation' : '/sign-up/household');
};
