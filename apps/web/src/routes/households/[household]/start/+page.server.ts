import { startHousehold, startOptions } from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the head starting it; the guard has checked that they are one of its
 * members (ADR-0017 §2). Start begins the plans, so it exists only while the plans' release flag is
 * on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.plans || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/**
 * The two ways to start the household (ADR-0007 §2 step 7, §3), while it is in setup; none once it
 * has started.
 */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await startOptions(context);
  if (!result.ok) {
    if (result.error === 'already-started') return { options: null };
    error(403);
  }
  const { timeZone, now, weekStart } = result;
  return {
    options: {
      timeZone,
      now: { today: now.today.toString(), last: now.last.toString() },
      weekStart: {
        week: weekStart.week.toString(),
        draftAt: weekStart.draftAt.epochMilliseconds,
        publishAt: weekStart.publishAt.epochMilliseconds,
      },
    },
  };
}) satisfies PageServerLoad;

export const actions = {
  // Starts the household: now, then to this week's draft to publish; or on the week start day,
  // then to the household's page, which says when the first plan comes (ADR-0007 §3).
  default: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const sent = (await request.formData()).get('when');
    const result = await startHousehold(context, { when: sent });
    const household = `/households/${context.householdId}`;
    if (result.ok)
      redirect(303, result.when === 'now' ? `${household}/plan` : `${household}?started`);
    if (result.error === 'not-allowed') error(403);
    // The choice stays chosen (UI-10).
    return fail(result.error === 'invalid' ? 400 : 409, {
      problem: result.error,
      when: typeof sent === 'string' ? sent : null,
    });
  },
} satisfies Actions;
