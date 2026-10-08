import { signInWithPassword } from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { afterSignIn } from '#lib/after-sign-in.js';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while its release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['sign-in']) error(404);
}

export const load: PageServerLoad = ({ locals, url }) => {
  needsFlag(locals);
  // After a new password was saved through a reset link (ADR-0010 §8).
  return { passwordChanged: url.searchParams.get('password') === 'changed' };
};

export const actions = {
  // Signs in with an e-mail address and a password (ADR-0010 §2).
  default: async ({ locals, request, cookies, getClientAddress, url }) => {
    needsFlag(locals);
    const form = await request.formData();
    const email = form.get('email');
    const context = await authContext();
    const result = await signInWithPassword(
      context,
      { email, password: form.get('password') },
      { address: getClientAddress(), userAgent: request.headers.get('user-agent') },
    );
    if (result.ok) {
      for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
      redirect(303, afterSignIn(url));
    }
    // The password was right, and two-factor is on: a code comes next (ADR-0010 §2).
    if (result.error === 'needs-code') {
      for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
      redirect(303, '/sign-in/two-factor');
    }
    // The e-mail address stays in the form; the password never comes back (UI-10).
    const typed = typeof email === 'string' ? email : '';
    if (result.error === 'wait') {
      const seconds = result.until.since(context.clock.now()).total('seconds');
      return fail(429, { email: typed, error: result.error, seconds: Math.ceil(seconds) });
    }
    return fail(400, { email: typed, error: result.error });
  },
} satisfies Actions;
