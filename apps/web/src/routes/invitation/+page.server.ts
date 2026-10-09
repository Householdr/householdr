import { acceptInvitation, offeredLanguages, openInvitation } from '@householdr/application';
import { signUpLinkAddress } from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { invitationCookie } from '#lib/server/invitation-link.js';
import { signUpCookie } from '#lib/server/sign-up-link.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while onboarding's release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags.onboarding) error(404);
}

/**
 * What the invitation in the cookie invites to, if it still works (ADR-0010 §5), and for someone
 * signed out who has confirmed their address with a sign-up link, what creating their account
 * asks (§1, clarification).
 */
export const load = (async ({ locals, cookies }) => {
  needsFlag(locals);
  const context = await authContext();
  const found = await openInvitation(context, cookies.get(invitationCookie.name));
  // A link that no longer works is forgotten.
  if (!found) cookies.delete(invitationCookie.name, invitationCookie.options);
  const invitation = found && { household: found.household, profile: found.profile };
  const signedIn = locals.session !== null;
  const email =
    invitation && !signedIn
      ? await signUpLinkAddress(context, cookies.get(signUpCookie.name))
      : null;
  return {
    invitation,
    signedIn,
    // The address the sign-up link confirmed, and the account's choices (ADR-0016 §2).
    signUp: email && { email, languages: offeredLanguages, terms: context.terms?.url ?? null },
  };
}) satisfies PageServerLoad;

export const actions = {
  // Joins the household as the profile the link is for (ADR-0010 §5).
  accept: async ({ locals, cookies }) => {
    needsFlag(locals);
    if (!locals.session) redirect(303, '/sign-in?next=invitation');
    const result = await acceptInvitation(
      await authContext(),
      locals.session.accountId,
      cookies.get(invitationCookie.name),
    );
    if (result.ok) {
      cookies.delete(invitationCookie.name, invitationCookie.options);
      redirect(303, `/households/${result.householdId}`);
    }
    // An expired link shows as such once the page loads again.
    return fail(result.error === 'expired' ? 410 : 409, { error: result.error });
  },
} satisfies Actions;
