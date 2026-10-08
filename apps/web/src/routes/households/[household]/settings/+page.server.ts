import {
  changeHouseholdSettings,
  householdSettings,
  offeredLanguages,
} from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening its settings; the guard has checked that they
 * are a member (ADR-0017 §2). The page exists only while its release flag is on (CODE-20).
 */
async function settingsContext(locals: App.Locals) {
  if (!locals.flags['household-settings'] || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** The household's settings, for a head to change (ADR-0007 §2). */
export const load = (async ({ locals }) => {
  const result = await householdSettings(await settingsContext(locals));
  if (!result.ok) error(403);
  // The languages a household can have (ADR-0016 §1, §2).
  return { settings: result.settings, languages: offeredLanguages };
}) satisfies PageServerLoad;

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');

export const actions = {
  // Saves the settings from the version the form was loaded with (ADR-0019 §5).
  save: async ({ locals, request }) => {
    const context = await settingsContext(locals);
    const form = await request.formData();
    const values = {
      name: text(form.get('name')),
      country: text(form.get('country')),
      timeZone: text(form.get('timeZone')),
      language: text(form.get('language')),
      version: Number(form.get('version')),
    };
    const result = await changeHouseholdSettings(context, values);
    if (result.ok) return { saved: true };
    if (result.error === 'not-allowed') error(403);
    // What was entered stays in the form (UI-10).
    if (result.error === 'invalid') return fail(400, { values, invalid: result.fields });
    // Their input stays, at the current version, so saving again keeps it (ADR-0019 §5).
    return fail(409, {
      values: { ...values, version: result.current.version },
      conflict: { current: result.current, changedBy: result.changedBy },
    });
  },
} satisfies Actions;
