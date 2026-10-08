import { signUpLinkAddress } from '@householdr/auth';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
  // The page exists only while its release flag is on (CODE-20).
  if (!locals.flags.onboarding) error(404);
  // A link that no longer works says so before anything is filled in (ADR-0010 §1, clarification).
  return { email: await signUpLinkAddress(await authContext(), cookies.get(signUpCookie.name)) };
};
