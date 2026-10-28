import { error, redirect } from '@sveltejs/kit';
import { unsubscribeCookie } from '#lib/server/unsubscribe-link.js';
import type { RequestHandler } from './$types';

/**
 * The unsubscribe link from an e-mail (ADR-0014 §6, clarification). Its token moves into a cookie
 * and out of the address bar at once (ADR-0017 §4); opening it changes nothing else.
 */
export const GET: RequestHandler = ({ locals, params, cookies }) => {
  if (!locals.flags['morning-email']) error(404);
  cookies.set(unsubscribeCookie.name, params.token, unsubscribeCookie.options);
  redirect(303, '/unsubscribe');
};
