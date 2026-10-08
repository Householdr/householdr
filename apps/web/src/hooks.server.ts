import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from './lib/paraglide/server.js';
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

// Hardening comes first, so it also covers any response the localisation returns itself.
export const handle = sequence(harden, localise);
