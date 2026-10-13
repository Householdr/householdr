import {
  changeNotificationPreferences,
  notificationPreferencesOf,
  type SavedPreferences,
} from '@householdr/application';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The account's own notification settings (ADR-0014 §3, clarification), for whoever is signed in.
 * The page exists only while its release flag is on (CODE-20).
 */
async function accountContext(locals: App.Locals) {
  if (!locals.flags['sign-in'] || !locals.flags['notification-preferences']) error(404);
  if (!locals.session) redirect(303, '/sign-in');
  const { db } = await authContext();
  return { db, account: locals.session.accountId };
}

/** Preferences as the form shows them: quiet hours as `HH:MM`, as a time field takes them. */
const formValues = ({ channels, quietHours, emailFallback, version }: SavedPreferences) => ({
  'plan.published': channels['plan.published'],
  'plan.drafted': channels['plan.drafted'],
  quietStart: quietHours.start.toString({ smallestUnit: 'minute' }),
  quietEnd: quietHours.end.toString({ smallestUnit: 'minute' }),
  emailFallback,
  version,
});

export const load = (async ({ locals }) => {
  const result = await notificationPreferencesOf(await accountContext(locals));
  if (!result.ok) error(403);
  return { preferences: formValues(result.preferences) };
}) satisfies PageServerLoad;

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');

export const actions = {
  // Saves the preferences from the version the form was loaded with (ADR-0019 §5).
  save: async ({ locals, request }) => {
    const context = await accountContext(locals);
    const form = await request.formData();
    const values = {
      'plan.published': text(form.get('plan.published')),
      'plan.drafted': text(form.get('plan.drafted')),
      quietStart: text(form.get('quietStart')),
      quietEnd: text(form.get('quietEnd')),
      // A ticked checkbox sends `on`; one left empty sends nothing.
      emailFallback: form.get('emailFallback') === 'on',
      version: Number(form.get('version')),
    };
    const result = await changeNotificationPreferences(context, values);
    if (result.ok) return { saved: true };
    if (result.error === 'not-allowed') error(403);
    // What was chosen stays in the form (UI-10).
    if (result.error === 'invalid') return fail(400, { values, invalid: result.fields });
    // The choices stay, at the current version, so saving again keeps them (ADR-0019 §5).
    const current = formValues(result.current);
    return fail(409, { values: { ...values, version: current.version }, conflict: current });
  },
} satisfies Actions;
