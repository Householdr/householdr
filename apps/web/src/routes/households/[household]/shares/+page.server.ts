import {
  addTemporaryShare,
  changeShare,
  householdShares,
  removeTemporaryShare,
  type TemporaryShareField,
} from '@householdr/application';
import { setShares } from '@householdr/domain';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening its shares; the guard has checked that they are
 * a member (ADR-0017 §2). The page exists only while its release flag is on (CODE-20).
 */
async function sharesContext(locals: App.Locals) {
  if (!locals.flags.shares || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** The shares the member may see, and whether they may change them (ADR-0018 §4). */
export const load = (async ({ locals }) => {
  const context = await sharesContext(locals);
  const result = await householdShares(context);
  if (!result.ok) error(403);
  return {
    shares: result.shares,
    mayChange: result.mayChange,
    range: setShares,
    temporaryDays: result.temporaryDays,
    you: context.member.id,
  };
}) satisfies PageServerLoad;

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');

/** A whole percent as entered, none being no number. */
const percentOf = (entered: string) => (entered === '' ? Number.NaN : Number(entered));

export const actions = {
  // Sets a member's share, or puts it back to the default, from the version the form was loaded
  // with (ADR-0001 §4, ADR-0019 §5).
  change: async ({ locals, request }) => {
    const context = await sharesContext(locals);
    const form = await request.formData();
    const member = text(form.get('member'));
    const entered = text(form.get('percent')).trim();
    const percent = form.get('use') === 'default' ? null : percentOf(entered);
    const result = await changeShare(context, {
      member,
      percent,
      version: Number(form.get('version')),
    });
    if (result.ok) return { saved: { id: result.share.id, name: result.share.name } };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // What was entered stays in the form (UI-10).
    if (result.error === 'invalid') return fail(400, { member, entered, invalid: true });
    // Their input stays, at the current version, so saving again keeps it (ADR-0019 §5).
    return fail(409, { member, entered, conflict: result.current });
  },

  // Adds a temporary share for a member (ADR-0001 §4, clarifications).
  addTemporary: async ({ locals, request }) => {
    const context = await sharesContext(locals);
    const form = await request.formData();
    const member = text(form.get('member'));
    const values = {
      firstDay: text(form.get('firstDay')),
      lastDay: text(form.get('lastDay')),
      percent: text(form.get('percent')).trim(),
    };
    const result = await addTemporaryShare(context, {
      member,
      ...values,
      percent: percentOf(values.percent),
    });
    if (result.ok) return { added: { id: member, name: result.share.name } };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // What was entered stays in the form (UI-10).
    if (result.error === 'invalid') {
      return fail(400, {
        temporary: { member, values, invalid: result.fields, overlapping: null },
      });
    }
    return fail(409, {
      temporary: {
        member,
        values,
        invalid: [] as TemporaryShareField[],
        overlapping: result.overlapping,
      },
    });
  },

  // Removes a member's temporary share (ADR-0001 §4).
  removeTemporary: async ({ locals, request }) => {
    const context = await sharesContext(locals);
    const id = (await request.formData()).get('id');
    const result = await removeTemporaryShare(context, { id });
    if (result.ok) return { removed: { name: result.share.name } };
    if (result.error === 'not-allowed') error(403);
    error(404);
  },
} satisfies Actions;
