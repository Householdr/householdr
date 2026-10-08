import { addTask, listTasks } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening its tasks; the guard has checked that they are
 * one of its members (ADR-0017 §2). The page exists only while the tasks' release flag is on
 * (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/**
 * The household's tasks, and what the member opening them may do there; whether a task was just
 * removed, as its page says when it leads back here.
 */
export const load = (async ({ locals, url }) => {
  const context = await householdContext(locals);
  const result = await listTasks(context);
  if (!result.ok) error(403);
  const { earliest, latest } = result.starts;
  return {
    household: result.household,
    tasks: result.tasks,
    mayChangeTasks: result.mayChangeTasks,
    starts: { earliest: earliest.toString(), latest: latest.toString() },
    removed: url.searchParams.get('task') === 'removed',
  };
}) satisfies PageServerLoad;

/** The text of a form's field, or nothing. */
const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
};

export const actions = {
  // Adds a custom task on a simple frequency (ADR-0004 §3, ADR-0007 §2).
  add: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const values = {
      name: text(form, 'name'),
      duration: text(form, 'duration'),
      frequency: text(form, 'frequency'),
      start: text(form, 'start'),
      onMiss: text(form, 'onMiss'),
    };
    const result = await addTask(context, {
      ...values,
      duration: Number(values.duration),
      // Without a day, it starts today.
      start: values.start || undefined,
    });
    if (result.ok) return { added: result.name };
    if (result.error === 'not-allowed') error(403);
    // What was typed stays in the form (UI-10).
    return fail(400, { invalid: result.fields, values });
  },
} satisfies Actions;
