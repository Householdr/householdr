import { error, redirect } from '@sveltejs/kit';
import { invitationCookie } from '#lib/server/invitation-link.js';
import type { RequestHandler } from './$types';

/**
 * An invitation link (ADR-0010 §5). Its token moves into a cookie and out of the address bar at
 * once, so it can't stay in the history or leak in a referrer (ADR-0017 §4).
 */
export const GET: RequestHandler = ({ locals, params, cookies }) => {
  if (!locals.flags.onboarding) error(404);
  cookies.set(invitationCookie.name, params.token, invitationCookie.options);
  redirect(303, '/invitation');
};
