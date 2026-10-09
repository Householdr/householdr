import { flagValues, membership, type Flags } from '@householdr/application';
import { currentSession, sessionCookie } from '@householdr/auth';
import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from './lib/paraglide/server.js';
import { authContext } from './lib/server/auth';
import { flagSource } from './lib/server/flags';
import { testFlagsCookie, withForcedFlags } from './lib/server/forced-flags';
import { securityHeaders } from './security';

/** The pages reached through a token link, from the link's own address to the page it leads to. */
const tokenLinkPages = new Set([
  '/reset-password/[token]',
  '/reset-password',
  '/sign-up/[token]',
  '/sign-up/household',
  '/sign-up/household/passkey/options',
  '/sign-up/household/passkey',
  '/invitations/[token]',
  '/invitation',
]);

/**
 * Every response carries the browser hardening of ADR-0017 §4. Pages reached through a token link
 * send no referrer to other sites, so the token can't leak there, yet their forms keep their origin
 * (§4, clarification).
 */
export const harden: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  if (tokenLinkPages.has(event.route.id ?? '')) {
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
  '/sign-in/passkey/options',
  '/sign-in/passkey',
  '/forgot-password',
  '/reset-password',
  '/reset-password/[token]',
  '/sign-up',
  '/sign-up/[token]',
  '/sign-up/household',
  '/sign-up/household/passkey/options',
  '/sign-up/household/passkey',
  '/invitations/[token]',
  '/invitation',
  '/health',
]);

/**
 * One guard, deny by default: without a session, a route sends to the sign-in page, and a route in a
 * household needs a membership of it, or is not found, whether or not the household exists
 * (ADR-0017 §2).
 */
export const guard: Handle = async ({ event, resolve }) => {
  const route = event.route.id;
  const { session } = event.locals;
  if (route !== null && !open.has(route) && !session) redirect(303, '/sign-in');
  event.locals.membership = null;
  const householdId = event.params.household;
  if (householdId !== undefined) {
    const member = session
      ? await membership(await authContext(), session.accountId, householdId)
      : null;
    if (!member) error(404);
    event.locals.membership = { householdId, member };
  }
  return resolve(event);
};

// Hardening comes first, so it also covers any response the localisation returns itself.
export const handle = sequence(harden, localise, flag, authenticate, guard);
