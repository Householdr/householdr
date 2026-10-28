import {
  answerSwap,
  completeOccurrence,
  draftPlan,
  moveAssignment,
  proposeSwap,
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

/** The same, for moving tasks, while their release flag is on too. */
async function moveContext(locals: App.Locals) {
  if (!locals.flags['plan-moves']) error(404);
  return householdContext(locals);
}

/** The same, for swaps, while their release flag is on too. */
async function swapContext(locals: App.Locals) {
  if (!locals.flags.swaps) error(404);
  return householdContext(locals);
}

/** A completion as page data: its day as `YYYY-MM-DD`, its moment as epoch milliseconds. */
const completionData = ({ id, day, when, at, doers, loggedBy, mayUndo }: PlanCompletion) => ({
  id,
  day: day.toString(),
  when,
  at: at?.epochMilliseconds ?? null,
  doers,
  loggedBy,
  mayUndo,
});

/**
 * A week's plan as page data: days as `YYYY-MM-DD`, a moment as epoch milliseconds. What is done,
 * and marking it done, only while completions' flag is on, and moving a task only while moves'
 * flag is (CODE-20).
 */
const weekData = (
  plan: WeekPlan | null,
  { completions, moves, swaps }: { completions: boolean; moves: boolean; swaps: boolean },
) => {
  if (!plan) return null;
  const item = (i: Omit<WeekPlan['unassigned'][number], 'cause'>) => ({
    id: i.id,
    occurrence: i.occurrence,
    task: i.task,
    date: i.date.toString(),
    // A task at set times shows its window, as epoch milliseconds (ADR-0004 §4, ADR-0018 §3).
    window: i.fixed
      ? { start: i.window.start.epochMilliseconds, end: i.window.end.epochMilliseconds }
      : null,
    completable: completions && i.completable,
    completion: completions && i.completion ? completionData(i.completion) : null,
    // What moving it sends, for a head who may (ADR-0006 §2–§3, ADR-0019 §5).
    move: moves && i.movable ? { version: i.version } : null,
    // Whether the reader may offer it in a swap (ADR-0002 §5).
    swappable: i.swappable && swaps,
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
    joinedSince: plan.joinedSince,
  };
};

/** This week's and next week's plans, as the member opening them may see them (ADR-0006 §2). */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await viewPlan(context);
  if (!result.ok) error(403);
  const shown = {
    completions: locals.flags.completions,
    moves: locals.flags['plan-moves'],
    swaps: locals.flags.swaps,
  };
  return {
    household: result.household,
    timeZone: result.timeZone,
    thisWeek: weekData(result.thisWeek, shown),
    nextWeek: weekData(result.nextWeek, shown),
    mayPublish: result.mayPublish,
    swaps: shown.swaps ? result.swaps : [],
    // From the plan, as from the tasks page, while the tasks' flag is on (CODE-20).
    mayAddOneOffs: locals.flags.tasks && result.mayAddOneOffs,
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

  // A head drafts a week again, as when someone joined after its draft was made (ADR-0002 §1,
  // clarification): the new draft replaces it.
  redraft: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const week = field(await request.formData(), 'week');
    const result = await draftPlan(context, { week });
    if (result.ok) return { week, redrafted: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Published or no longer drafted in the meantime: the page then shows what there is.
    return fail(409, { week, problem: 'redraft-gone' as const });
  },

  // A head gives a task to someone else: in a draft, or after publishing (ADR-0006 §2–§3).
  move: async ({ locals, request }) => {
    const context = await moveContext(locals);
    const form = await request.formData();
    const occurrence = field(form, 'occurrence');
    const result = await moveAssignment(context, {
      assignment: field(form, 'assignment'),
      version: Number(form.get('version')),
      member: field(form, 'member'),
    });
    if (result.ok) return { occurrence, moved: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Changed or gone in the meantime: the page then shows what there is.
    return fail(409, {
      occurrence,
      problem: result.error === 'conflict' ? ('move-conflict' as const) : ('not-movable' as const),
    });
  },

  // Offers a task to another member, for one of theirs or nothing (ADR-0002 §5). The choice is
  // `member:assignment`, the assignment empty for a hand-off.
  propose: async ({ locals, request }) => {
    const context = await swapContext(locals);
    const form = await request.formData();
    const occurrence = field(form, 'occurrence');
    const [to = '', take = ''] = field(form, 'choice').split(':');
    const result = await proposeSwap(context, {
      from: field(form, 'from'),
      give: field(form, 'give'),
      to,
      ...(take ? { take } : {}),
    });
    if (result.ok) return { occurrence, proposed: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Done, moved or offered already in the meantime: the page then shows what there is.
    return fail(409, {
      occurrence,
      problem:
        result.error === 'already-proposed'
          ? ('swap-already' as const)
          : ('swap-not-swappable' as const),
    });
  },

  // Accepts or declines a swap proposed to the member, or to a profile a head acts for.
  answer: async ({ locals, request }) => {
    const context = await swapContext(locals);
    const form = await request.formData();
    const accept = field(form, 'answer') === 'accept';
    const result = await answerSwap(context, { swap: field(form, 'swap'), accept });
    if (result.ok) return { answered: accept ? ('accepted' as const) : ('declined' as const) };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'invalid') error(400);
    // Answered already, or something in it was done or moved since.
    return fail(409, { swapProblem: result.error });
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
