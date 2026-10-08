import { editTask, taskToEdit, type EditableTask } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening one of its tasks; the guard has checked that they
 * are one of its members (ADR-0017 §2). The page exists only while the tasks' release flag is on
 * (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** A task as the page shows it, its first time as `YYYY-MM-DD`. */
const shown = (task: EditableTask) => ({ ...task, start: task.start.toString() });

/** The task, for a head to change (ADR-0001 §2), from the version it is at now (ADR-0019 §5). */
export const load = (async ({ locals, params }) => {
  const result = await taskToEdit(await householdContext(locals), { taskId: params.task });
  if (!result.ok) error(result.error === 'not-found' ? 404 : 403);
  const { earliest, latest } = result.starts;
  return {
    household: result.household,
    task: shown(result.task),
    starts: { earliest: earliest.toString(), latest: latest.toString() },
  };
}) satisfies PageServerLoad;

/** The text of a form's field, or nothing. */
const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
};

export const actions = {
  // Saves the task from the version the form was loaded with (ADR-0019 §5).
  save: async ({ locals, params, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const values = {
      name: text(form, 'name'),
      duration: text(form, 'duration'),
      frequency: text(form, 'frequency'),
      start: text(form, 'start'),
      onMiss: text(form, 'onMiss'),
      version: Number(form.get('version')),
    };
    const result = await editTask(context, {
      ...values,
      taskId: params.task,
      duration: Number(values.duration),
    });
    if (result.ok) return { saved: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // What was typed stays in the form (UI-10).
    if (result.error === 'invalid') return fail(400, { values, invalid: result.fields });
    // Their input stays, at the current version, so saving again keeps it (ADR-0019 §5).
    return fail(409, {
      values: { ...values, version: result.current.version },
      conflict: { current: shown(result.current) },
    });
  },
} satisfies Actions;
