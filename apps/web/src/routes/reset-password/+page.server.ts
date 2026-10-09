import { resetLink, setNewPassword } from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { resetCookie } from '#lib/server/reset-link.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The page exists only while its release flag is on (CODE-20). An account with two-factor on is
 * asked for a code here too, as at sign-in, whatever two-factor's own flag: only that flag lets an
 * account turn it on, and it stays asked for once it has.
 */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['password-reset']) error(404);
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
  needsFlag(locals);
  // A link that no longer works says so before a new password is typed, and one that does says
  // whether a code is needed too.
  const link = await resetLink(await authContext(), cookies.get(resetCookie.name));
  return { link: link !== null, code: link?.code ?? false };
};

export const actions = {
  // Sets the new password with the link's token, and a code if two-factor is on (ADR-0010 §8).
  default: async ({ locals, request, cookies }) => {
    needsFlag(locals);
    const form = await request.formData();
    const token = cookies.get(resetCookie.name);
    const context = await authContext();
    const result = await setNewPassword(context, {
      token,
      password: form.get('password'),
      code: form.get('code'),
    });
    if (result.ok || result.error === 'expired') {
      cookies.delete(resetCookie.name, resetCookie.options);
    }
    if (result.ok) redirect(303, '/sign-in?password=changed');
    if (result.error === 'wait') {
      const seconds = result.until.since(context.clock.now()).total('seconds');
      return fail(429, { error: result.error, seconds: Math.ceil(seconds) });
    }
    // The password and the code never come back into the page (ADR-0011 §6, clarification).
    return fail(400, { error: result.error });
  },
} satisfies Actions;
