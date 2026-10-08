import { requestSignUp } from '@householdr/auth';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while its release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags.onboarding) error(404);
}

export const load: PageServerLoad = ({ locals }) => {
  needsFlag(locals);
};

export const actions = {
  // Asks for a link to confirm the e-mail address, the first step of signing up (ADR-0010 §1).
  default: async ({ locals, request, getClientAddress }) => {
    needsFlag(locals);
    const email = (await request.formData()).get('email');
    const typed = typeof email === 'string' ? email : '';
    const result = await requestSignUp(
      await authContext(),
      { email },
      { address: getClientAddress() },
    );
    if (!result.ok)
      return fail(result.error === 'wait' ? 429 : 400, { email: typed, error: result.error });
    // The same answer whether or not the address has an account (ADR-0010 §2).
    return { email: typed, sent: true as const };
  },
} satisfies Actions;
