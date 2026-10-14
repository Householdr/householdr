import { leaveHousehold, leaveOptions } from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member leaving it; the guard has checked that they are one of
 * its members (ADR-0017 §2). The page exists only while leaving's release flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.leaving || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** What the member is asked before they leave, and the support line (ADR-0018 §2, §8). */
export const load = (async ({ locals }) => {
  const result = await leaveOptions(await householdContext(locals));
  if (!result.ok) error(403);
  const { household, name, lastHead, support } = result;
  return { household, name, lastHead, support };
}) satisfies PageServerLoad;

export const actions = {
  // Leaves at once, then to the account's households, which say so (ADR-0018 §2).
  default: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const shownAs = (await request.formData()).get('shownAs');
    const result = await leaveHousehold(context, { shownAs });
    if (result.ok) redirect(303, '/?left');
    if (result.error === 'not-allowed') error(403);
    // The choice stays chosen (UI-10).
    return fail(result.error === 'invalid' ? 400 : 409, {
      problem: result.error,
      shownAs: typeof shownAs === 'string' ? shownAs : null,
    });
  },
} satisfies Actions;
