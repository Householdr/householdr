import type { Handle } from '@sveltejs/kit/hooks';
import { securityHeaders } from './security';

/** Every response carries the browser hardening of ADR-0017 §4. */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
};
