import { memberToRemove, removeMember } from '@householdr/application';
import { signedInRecently } from '@householdr/auth';
import { error, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the head removing one of its members; the guard has checked that
 * they are one of its members (ADR-0017 §2), and whether their sign-in is recent, which removing a
 * member needs (ADR-0010 §6). The page exists only while its release flag is on (CODE-20).
 */
async function removingContext(locals: App.Locals) {
  if (!locals.flags['removing-members'] || !locals.membership || !locals.session) error(404);
  const context = await authContext();
  const recentSignIn = await signedInRecently(context, locals.session);
  return { db: context.db, clock: context.clock, ...locals.membership, recentSignIn };
}

/** The member a head is asked to confirm removing (ADR-0005 §4, ADR-0018 §4). */
export const load = (async ({ locals, params }) => {
  const result = await memberToRemove(await removingContext(locals), { member: params.member });
  if (!result.ok) error(result.error === 'not-found' ? 404 : 403);
  const { household, name, role, confirm } = result;
  return { household, name, role, confirm };
}) satisfies PageServerLoad;

export const actions = {
  // Removes the member, then shows the household without them (ADR-0005 §4, clarification).
  default: async ({ locals, params }) => {
    const context = await removingContext(locals);
    const result = await removeMember(context, { member: params.member });
    if (result.ok) redirect(303, `/households/${params.household}?removed`);
    if (result.error === 'not-found') error(404);
    if (result.error === 'not-allowed') error(403);
    // An old sign-in: the page asks to confirm it is them first (ADR-0010 §6).
    redirect(303, `/households/${params.household}/members/${params.member}/remove`);
  },
} satisfies Actions;
