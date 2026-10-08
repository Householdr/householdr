import { flagValues, type Flags } from '@householdr/application';
import { currentSession, sessionCookie } from '@householdr/auth';
import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from './lib/paraglide/server.js';
import { authContext } from './lib/server/auth';
import { flagSource } from './lib/server/flags';
import { testFlagsCookie, withForcedFlags } from './lib/server/forced-flags';
import { securityHeaders } from './security';

/**
 * Every response carries the browser hardening of ADR-0017 §4. Pages reached through a token link
 * send no referrer to other sites, so the token can't leak there, yet their forms keep their origin
 * (§4, clarification).
 */
export const harden: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  if (event.route.id?.startsWith('/reset-password')) {
    response.headers.set('referrer-policy', 'same-origin');
  }
  return response;
};

/** Each request renders in its language, which the page's `lang` attribute names (ADR-0008 §6). */
export const localise: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) =>
    resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale),
    }),
  );

let flags: Flags | undefined;

/**
 * Every flag is evaluated once per request, on the server (ADR-0015 §3). In the test build, a test
 * can force flags with a cookie (§10); a production build doesn't contain that code at all.
 */
export const flag: Handle = ({ event, resolve }) => {
  flags ??= flagSource();
  const values = flagValues(flags);
  event.locals.flags =
    import.meta.env.MODE === 'test'
      ? withForcedFlags(values, event.cookies.get(testFlagsCookie))
      : values;
  return resolve(event);
};

/**
 * Who the request is signed in as, from its session cookie (ADR-0010 §6, ADR-0023 §2,
 * clarification). Only a request with the cookie needs the database.
 */
export const authenticate: Handle = async ({ event, resolve }) => {
  event.locals.session = null;
  if (event.cookies.get(sessionCookie) !== undefined) {
    const { auth } = await authContext();
    const { session, cookies } = await currentSession(auth, event.request.headers);
    for (const cookie of cookies) event.cookies.set(cookie.name, cookie.value, cookie.options);
    event.locals.session = session;
  }
  return resolve(event);
};

/** The routes anyone may open; every other one needs a session (ADR-0017 §2). */
const open = new Set([
  '/sign-in',
  '/forgot-password',
  '/reset-password',
  '/reset-password/[token]',
  '/health',
]);

/**
 * One guard, deny by default: without a session, a route sends to the sign-in page (ADR-0017 §2).
 * Membership of the household named in the request joins it once accounts are linked to members.
 */
export const guard: Handle = ({ event, resolve }) => {
  const route = event.route.id;
  if (route !== null && !open.has(route) && !event.locals.session) redirect(303, '/sign-in');
  return resolve(event);
};

// Hardening comes first, so it also covers any response the localisation returns itself.
export const handle = sequence(harden, localise, flag, authenticate, guard);
