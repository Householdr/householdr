import { resetLinkWorks, setNewPassword } from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { resetCookie } from '#lib/server/reset-link.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while its release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['password-reset']) error(404);
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
  needsFlag(locals);
  // A link that no longer works says so before a new password is typed.
  return { link: await resetLinkWorks(await authContext(), cookies.get(resetCookie.name)) };
};

export const actions = {
  // Sets the new password with the link's token (ADR-0010 §8).
  default: async ({ locals, request, cookies }) => {
    needsFlag(locals);
    const password = (await request.formData()).get('password');
    const token = cookies.get(resetCookie.name);
    const result = await setNewPassword(await authContext(), { token, password });
    if (result.ok || result.error === 'expired') {
      cookies.delete(resetCookie.name, resetCookie.options);
    }
    if (result.ok) redirect(303, '/sign-in?password=changed');
    // The password never comes back into the page (ADR-0011 §6, clarification).
    return fail(400, { error: result.error });
  },
} satisfies Actions;
