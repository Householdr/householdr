import type { Session } from '@householdr/auth';
import { error } from '@sveltejs/kit';

/** Passkeys exist while signing in and passkeys are released (CODE-20). */
export function requirePasskeys(locals: App.Locals) {
  if (!locals.flags['sign-in'] || !locals.flags.passkeys) error(404);
}

/**
 * The session whose passkeys change, or that confirms it's you with one, while passkeys are
 * released. The guard has already sent a request without a session to the sign-in page.
 */
export function passkeysSession(locals: App.Locals): Session {
  requirePasskeys(locals);
  if (!locals.session) error(401);
  return locals.session;
}
