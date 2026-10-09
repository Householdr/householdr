import { removeTask, taskToEdit, type EditableTask } from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member removing one of its tasks; the guard has checked that
 * they are one of its members (ADR-0017 §2). The page exists only while the tasks' release flag is
 * on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** A task as the page shows it, its first time as `YYYY-MM-DD`. */
const shown = (task: EditableTask) => ({ ...task, start: task.start.toString() });

/** The task a head is asked to confirm removing (ADR-0001 §2), at the version it is at now. */
export const load = (async ({ locals, params }) => {
  const result = await taskToEdit(await householdContext(locals), { taskId: params.task });
  if (!result.ok) error(result.error === 'not-found' ? 404 : 403);
  return { household: result.household, task: shown(result.task) };
}) satisfies PageServerLoad;

export const actions = {
  // Removes the task as the confirmation showed it (ADR-0019 §5), then shows the tasks left.
  default: async ({ locals, params, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const result = await removeTask(context, {
      taskId: params.task,
      version: Number(form.get('version')),
    });
    if (result.ok) redirect(303, `/households/${params.household}/tasks?task=removed`);
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    if (result.error === 'invalid') error(400);
    // Changed since: the task now, to confirm again (ADR-0019 §5).
    return fail(409, { conflict: { current: shown(result.current) } });
  },
} satisfies Actions;
