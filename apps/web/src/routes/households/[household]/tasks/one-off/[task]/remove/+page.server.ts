import { oneOffToEdit, removeOneOff, type EditableOneOff } from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member removing one of its one-off tasks; the guard has checked
 * that they are one of its members (ADR-0017 §2). The page exists only while the tasks' release
 * flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** A one-off task as the page shows it, its days as `YYYY-MM-DD`. */
const shown = (oneOff: EditableOneOff) => ({
  ...oneOff,
  date: oneOff.date.toString(),
  deadline: oneOff.deadline?.toString(),
});

/**
 * The one-off task the member who added it, or a head, is asked to confirm removing (ADR-0006 §3,
 * clarification), at the version it is at now.
 */
export const load = (async ({ locals, params }) => {
  const result = await oneOffToEdit(await householdContext(locals), { taskId: params.task });
  if (!result.ok) error(result.error === 'not-found' ? 404 : 403);
  return { household: result.household, oneOff: shown(result.oneOff) };
}) satisfies PageServerLoad;

export const actions = {
  // Removes the one-off as the confirmation showed it (ADR-0019 §5), then shows the tasks left.
  default: async ({ locals, params, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const result = await removeOneOff(context, {
      taskId: params.task,
      version: Number(form.get('version')),
    });
    if (result.ok) redirect(303, `/households/${params.household}/tasks?task=removed`);
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    if (result.error === 'invalid') error(400);
    // Changed since: the one-off now, to confirm again (ADR-0019 §5).
    return fail(409, { conflict: { current: shown(result.current) } });
  },
} satisfies Actions;
