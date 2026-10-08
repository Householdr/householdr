import { flagValues, type Flags } from '@householdr/application';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from './lib/paraglide/server.js';
import { flagSource } from './lib/server/flags';
import { testFlagsCookie, withForcedFlags } from './lib/server/forced-flags';
import { securityHeaders } from './security';

/** Every response carries the browser hardening of ADR-0017 §4. */
export const harden: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
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

// Hardening comes first, so it also covers any response the localisation returns itself.
export const handle = sequence(harden, localise, flag);
