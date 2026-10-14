import { addArea, listAreas, removeArea, renameArea } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening its areas; the guard has checked that they are
 * one of its members (ADR-0017 §2). The page exists only while the tasks' release flag is on
 * (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** The household's areas, which every member sees, and whether the member may change them. */
export const load = (async ({ locals }) => {
  const result = await listAreas(await householdContext(locals));
  if (!result.ok) error(403);
  return { household: result.household, areas: result.areas, mayChange: result.mayChange };
}) satisfies PageServerLoad;

/** The text of a form's field, or nothing. */
const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
};

export const actions = {
  // Adds an area, by a head (ADR-0001 §1, clarification).
  add: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const name = text(await request.formData(), 'name');
    const result = await addArea(context, { name });
    if (result.ok) return { added: result.name };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // What was typed stays in the form (UI-10).
    return fail(400, { problem: result.error, areaId: undefined, name });
  },
  // Renames an area, by a head.
  rename: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const areaId = text(form, 'areaId');
    const name = text(form, 'name');
    const result = await renameArea(context, { areaId, name });
    if (result.ok) return { renamed: result.name };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    return fail(400, { problem: result.error, areaId, name });
  },
  // Removes an area, by a head; its tasks are left without one.
  remove: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const result = await removeArea(context, { areaId: text(await request.formData(), 'areaId') });
    if (result.ok) return { removed: result.name };
    if (result.error === 'not-allowed') error(403);
    error(404);
  },
} satisfies Actions;
