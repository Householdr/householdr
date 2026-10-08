import { error, redirect } from '@sveltejs/kit';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { RequestHandler } from './$types';

/**
 * The link from a sign-up e-mail. Its token moves into a cookie and out of the address bar at once,
 * so it can't stay in the history or leak in a referrer (ADR-0017 §4).
 */
export const GET: RequestHandler = ({ locals, params, cookies }) => {
  if (!locals.flags.onboarding) error(404);
  cookies.set(signUpCookie.name, params.token, signUpCookie.options);
  redirect(303, '/sign-up/household');
};
