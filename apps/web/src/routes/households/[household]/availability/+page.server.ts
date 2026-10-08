import { addAbsence, removeAbsence, viewAvailability } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening it; the guard has checked that they are one
 * (ADR-0017 §2). The page exists only while its release flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.availability || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** A form field's text, or nothing. */
const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');

/** Who is away when, with days as `YYYY-MM-DD`, and whose days the member opening it manages. */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await viewAvailability(context);
  if (!result.ok) error(403);
  return {
    members: result.members.map(({ absences, ...member }) => ({
      ...member,
      absences: absences.map(({ id, from, to }) => ({
        id,
        from: from.toString(),
        to: to.toString(),
      })),
    })),
    plannable: { from: result.plannable.from.toString(), to: result.plannable.to.toString() },
    you: context.member.id,
  };
}) satisfies PageServerLoad;

// Each change says whose days it was about, so the page shows its outcome next to them.
export const actions = {
  // Plans days away (ADR-0005 §2).
  add: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const input = {
      member: text(form.get('member')),
      firstDay: text(form.get('firstDay')),
      lastDay: text(form.get('lastDay')),
    };
    const result = await addAbsence(context, input);
    if (result.ok) return { done: 'added' as const, member: input.member };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // The days stay in the form (UI-10).
    return fail(400, { ...input, invalid: result.fields });
  },
  remove: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const result = await removeAbsence(context, { absence: form.get('absence') });
    const member = text(form.get('member'));
    if (result.ok) return { done: 'removed' as const, member };
    if (result.error === 'not-allowed') error(403);
    // Removed a moment ago by someone else: the page then shows what is left.
    return { done: 'already-removed' as const, member };
  },
} satisfies Actions;
