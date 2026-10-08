import { error, redirect } from '@sveltejs/kit';
import { resetCookie } from '#lib/server/reset-link.js';
import type { RequestHandler } from './$types';

/**
 * The link from a reset e-mail. Its token moves into a cookie and out of the address bar at once,
 * so it can't stay in the history or leak in a referrer (ADR-0017 §4).
 */
export const GET: RequestHandler = ({ locals, params, cookies }) => {
  if (!locals.flags['password-reset']) error(404);
  cookies.set(resetCookie.name, params.token, resetCookie.options);
  redirect(303, '/reset-password');
};
