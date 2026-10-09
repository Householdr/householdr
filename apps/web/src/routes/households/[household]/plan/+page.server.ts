import {
  completeOccurrence,
  publishPlan,
  undoCompletion,
  viewPlan,
  type PlanCompletion,
  type WeekPlan,
} from '@householdr/application';
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

/** The same, for marking tasks done and undoing it, while their release flag is on too. */
async function completionContext(locals: App.Locals) {
  if (!locals.flags.completions) error(404);
  return householdContext(locals);
}

/** A completion as page data: its day as `YYYY-MM-DD`, its moment as epoch milliseconds. */
const completionData = ({ id, day, at, doers, loggedBy, mayUndo }: PlanCompletion) => ({
  id,
  day: day.toString(),
  at: at?.epochMilliseconds ?? null,
  doers,
  loggedBy,
  mayUndo,
});

/**
 * A week's plan as page data: days as `YYYY-MM-DD`, a moment as epoch milliseconds. What is done,
 * and marking it done, only while completions' flag is on (CODE-20).
 */
const weekData = (plan: WeekPlan | null, completions: boolean) => {
  if (!plan) return null;
  const item = (i: Omit<WeekPlan['unassigned'][number], 'cause'>) => ({
    id: i.id,
    occurrence: i.occurrence,
    task: i.task,
    date: i.date.toString(),
    completable: completions && i.completable,
    completion: completions && i.completion ? completionData(i.completion) : null,
  });
  return {
    start: plan.start.toString(),
    last: plan.end.subtract({ days: 1 }).toString(),
    status: plan.status,
    version: plan.version,
    publishAt: plan.publishAt?.epochMilliseconds ?? null,
    members: plan.members.map(({ id, name, assignments }) => ({
      id,
      name,
      assignments: assignments.map((a) => ({ ...item(a), cost: a.cost, reason: a.reason })),
    })),
    unassigned: plan.unassigned.map((u) => ({ ...item(u), cause: u.cause })),
  };
};

/** This week's and next week's plans, as the member opening them may see them (ADR-0006 §2). */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await viewPlan(context);
  if (!result.ok) error(403);
  const completions = locals.flags.completions;
  return {
    household: result.household,
    timeZone: result.timeZone,
    thisWeek: weekData(result.thisWeek, completions),
    nextWeek: weekData(result.nextWeek, completions),
    mayPublish: result.mayPublish,
    you: context.member.id,
  };
}) satisfies PageServerLoad;

/** A field of `form` as text, or empty. */
const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * What completing occurrence `occurrence` came to, for the page to show next to it. Who did it
 * already, if someone did; why else it can't be done: closed, gone, or not in this week's plan.
 */
function completed(occurrence: string, result: Awaited<ReturnType<typeof completeOccurrence>>) {
  if (result.ok) return { occurrence, completed: true };
  if (result.error === 'not-allowed') error(403);
  if (result.error === 'invalid') error(400);
  if (result.error === 'already-done') {
    return fail(409, { occurrence, problem: result.error, doers: result.doers });
  }
  return fail(409, { occurrence, problem: 'not-completable' as const });
}

export const actions = {
  // A head publishes the draft they see early (ADR-0006 §2).
  publish: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const week = field(form, 'week');
    const result = await publishPlan(context, { week, version: Number(form.get('version')) });
    // Each outcome says which week it was about, so the page shows it there.
    if (result.ok) return { week, published: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Drafted again since the head saw it, or gone: the page then shows what there is.
    return fail(409, { week, problem: result.error });
  },

  // One tap: the member marks a task done that they did themselves (ADR-0006 §4).
  complete: async ({ locals, request }) => {
    const context = await completionContext(locals);
    const form = await request.formData();
    const occurrence = field(form, 'occurrence');
    return completed(occurrence, await completeOccurrence(context, { occurrence }));
  },

  // Done by the members chosen: on someone's behalf, picked up, or together (ADR-0006 §4).
  completeBy: async ({ locals, request }) => {
    const context = await completionContext(locals);
    const form = await request.formData();
    const occurrence = field(form, 'occurrence');
    const doers = form.getAll('doer').filter((doer) => typeof doer === 'string');
    const result = await completeOccurrence(context, { occurrence, doers });
    // With nobody chosen, the choice is what needs changing.
    if (!result.ok && result.error === 'invalid' && doers.length === 0) {
      return fail(400, { occurrence, problem: 'no-doers' as const });
    }
    return completed(occurrence, result);
  },

  // Undone within its week by whoever logged it, a member it credits, or a head (ADR-0006 §4).
  undo: async ({ locals, request }) => {
    const context = await completionContext(locals);
    const form = await request.formData();
    const occurrence = field(form, 'occurrence');
    const result = await undoCompletion(context, { completion: field(form, 'completion') });
    if (result.ok) return { occurrence, undone: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Undone already by someone else, or its week is over: the page shows what there is.
    return fail(409, { occurrence, problem: result.error });
  },
} satisfies Actions;
