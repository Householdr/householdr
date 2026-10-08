import { acceptInvitation, openInvitation } from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { invitationCookie } from '#lib/server/invitation-link.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while onboarding's release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags.onboarding) error(404);
}

/** What the invitation in the cookie invites to, if it still works (ADR-0010 §5). */
export const load = (async ({ locals, cookies }) => {
  needsFlag(locals);
  const invitation = await openInvitation(await authContext(), cookies.get(invitationCookie.name));
  // A link that no longer works is forgotten.
  if (!invitation) cookies.delete(invitationCookie.name, invitationCookie.options);
  return { invitation, signedIn: locals.session !== null };
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
