import { publishPlan, viewPlan, type WeekPlan } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening its plan; the guard has checked that they are one
 * of its members (ADR-0017 §2). The page exists only while the plans' release flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.plans || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** A week's plan as page data: days as `YYYY-MM-DD`, a moment as epoch milliseconds. */
const weekData = (plan: WeekPlan | null) =>
  plan && {
    start: plan.start.toString(),
    last: plan.end.subtract({ days: 1 }).toString(),
    status: plan.status,
    version: plan.version,
    publishAt: plan.publishAt?.epochMilliseconds ?? null,
    members: plan.members.map(({ id, name, assignments }) => ({
      id,
      name,
      assignments: assignments.map(({ id, task, date, cost, reason }) => ({
        id,
        task,
        date: date.toString(),
        cost,
        reason,
      })),
    })),
    unassigned: plan.unassigned.map(({ id, task, date, cause }) => ({
      id,
      task,
      date: date.toString(),
      cause,
    })),
  };

/** This week's and next week's plans, as the member opening them may see them (ADR-0006 §2). */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await viewPlan(context);
  if (!result.ok) error(403);
  return {
    household: result.household,
    timeZone: result.timeZone,
    thisWeek: weekData(result.thisWeek),
    nextWeek: weekData(result.nextWeek),
    mayPublish: result.mayPublish,
    you: context.member.id,
  };
}) satisfies PageServerLoad;

export const actions = {
  // A head publishes the draft they see early (ADR-0006 §2).
  publish: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const sent = form.get('week');
    const week = typeof sent === 'string' ? sent : '';
    const result = await publishPlan(context, { week, version: Number(form.get('version')) });
    // Each outcome says which week it was about, so the page shows it there.
    if (result.ok) return { week, published: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Drafted again since the head saw it, or gone: the page then shows what there is.
    return fail(409, { week, problem: result.error });
  },
} satisfies Actions;
