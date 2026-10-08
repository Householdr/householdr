import type { Session } from '@householdr/auth';
import { error } from '@sveltejs/kit';

/**
 * The session whose passkeys change, while the security page and its passkeys are released
 * (CODE-20). The guard has already sent a request without a session to the sign-in page.
 */
export function passkeysSession(locals: App.Locals): Session {
  if (!locals.flags['sign-in'] || !locals.flags.passkeys) error(404);
  if (!locals.session) error(401);
  return locals.session;
}
