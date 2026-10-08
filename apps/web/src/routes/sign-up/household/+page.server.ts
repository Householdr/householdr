import { offeredLanguages } from '@householdr/application';
import { signUpLinkAddress } from '@householdr/auth';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
  // The page exists only while its release flag is on (CODE-20).
  if (!locals.flags.onboarding) error(404);
  const context = await authContext();
  return {
    // The address the link confirmed; a link that no longer works says so before anything is
    // filled in (ADR-0010 §1, clarification).
    email: await signUpLinkAddress(context, cookies.get(signUpCookie.name)),
    // The languages a household and its head can choose (ADR-0016 §1, §2).
    languages: offeredLanguages,
    // The instance's terms, if it has any, for the head to accept (ADR-0007 §2, clarification).
    terms: context.terms?.url ?? null,
  };
};
