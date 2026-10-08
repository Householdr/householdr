import { answerComparison, comparisonGame } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member playing the comparison game; the guard has checked that
 * they are one of its members (ADR-0017 §2). The page exists only while the game's release flag is
 * on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.comparisons || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/**
 * The next pair to compare, after the pairs skipped, and the member's own burdens (ADR-0003 §3a,
 * §5). Skipping records nothing, so it only asks for this page with one more pair skipped.
 */
export const load = (async ({ locals, url }) => {
  const context = await householdContext(locals);
  const result = await comparisonGame(context, {
    skipped: Number(url.searchParams.get('skipped') ?? 0),
  });
  if (!result.ok) error(result.error === 'invalid' ? 400 : 403);
  return {
    household: result.household,
    pair: result.pair,
    skipped: result.skipped,
    answered: result.answered,
    burdens: result.burdens,
  };
}) satisfies PageServerLoad;

export const actions = {
  // Which of the two tasks is harder for the member (ADR-0003 §3a).
  answer: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const result = await answerComparison(context, {
      tasks: form.getAll('tasks'),
      harder: form.get('harder'),
    });
    if (result.ok) return { answered: { harder: result.harder, easier: result.easier } };
    if (result.error === 'not-allowed') error(403);
    // A task may have gone since the page was loaded; the page asks the next pair.
    return fail(400, { refused: true });
  },
} satisfies Actions;
