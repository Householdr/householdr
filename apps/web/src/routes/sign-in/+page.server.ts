import { signInWithPassword } from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while its release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['sign-in']) error(404);
}

export const load: PageServerLoad = ({ locals }) => {
  needsFlag(locals);
};

export const actions = {
  // Signs in with an e-mail address and a password (ADR-0010 §2).
  default: async ({ locals, request, cookies, getClientAddress }) => {
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
      // The security page, until the household's pages exist.
      redirect(303, '/security');
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
