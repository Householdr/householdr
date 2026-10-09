import { addAdult, viewHousehold } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening it; the guard has checked that they are one
 * (ADR-0017 §2). The page exists only while onboarding's release flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.onboarding || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/**
 * The household's name and its members, and what the member opening it may do there. Right after
 * a head started it on the week start day, which sends them here, when its first plan comes
 * (ADR-0007 §3).
 */
export const load = (async ({ locals, url }) => {
  const context = await householdContext(locals);
  const result = await viewHousehold(context);
  if (!result.ok) error(403);
  const { firstPlan } = result;
  return {
    name: result.name,
    members: result.members,
    mayAddMembers: result.mayAddMembers,
    mayChangeSettings: result.mayChangeSettings,
    mayStart: result.mayStart,
    started:
      url.searchParams.has('started') && firstPlan
        ? {
            week: firstPlan.week.toString(),
            draftAt: firstPlan.draftAt.epochMilliseconds,
            publishAt: firstPlan.publishAt.epochMilliseconds,
            timeZone: firstPlan.publishAt.timeZoneId,
          }
        : null,
    you: context.member.id,
  };
}) satisfies PageServerLoad;

export const actions = {
  // Adds an adult's profile (ADR-0007 §1, §2); the page then asks to let them know (ADR-0012 §9).
  addAdult: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const name = (await request.formData()).get('name');
    const result = await addAdult(context, { name });
    if (result.ok) return { added: result.name };
    if (result.error === 'not-allowed') error(403);
    // The name stays in the form (UI-10).
    return fail(400, { invalid: true, name: typeof name === 'string' ? name : '' });
  },
} satisfies Actions;
