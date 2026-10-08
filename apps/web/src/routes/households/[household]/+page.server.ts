import {
  addAdult,
  addChild,
  invite,
  revokeInvitation,
  viewHousehold,
} from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import { authContext } from '#lib/server/auth.js';
import { qrCode } from '#lib/server/qr-code.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening it; the guard has checked that they are one
 * (ADR-0017 §2). The page exists only while onboarding's release flag is on (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.onboarding || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/** The profile a form is about, as sent. */
const memberIn = async (request: Request) => {
  const member = (await request.formData()).get('member');
  return typeof member === 'string' ? member : '';
};

/** Whole days, rounded up, until `then`, so the page needs no time zone. */
const daysUntil = (now: Temporal.Instant, then: Temporal.Instant) =>
  Math.ceil(then.since(now).total('hours') / 24);

/** The household's name and its members, and what the member opening it may do there. */
export const load = (async ({ locals }) => {
  const context = await householdContext(locals);
  const result = await viewHousehold(context);
  if (!result.ok) error(403);
  const now = context.clock.now();
  return {
    name: result.name,
    members: result.members.map(({ invitationExpiresAt, ...member }) => ({
      ...member,
      invitationDaysLeft: invitationExpiresAt ? daysUntil(now, invitationExpiresAt) : null,
    })),
    mayAddMembers: result.mayAddMembers,
    mayChangeSettings: result.mayChangeSettings,
    you: context.member.id,
  };
}) satisfies PageServerLoad;

export const actions = {
  // Adds an adult's profile (ADR-0007 §1, §2); the page then asks to let them know (ADR-0012 §9).
  addAdult: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const name = (await request.formData()).get('name');
    const result = await addAdult(context, { name });
    if (result.ok) return { added: result.name };
    if (result.error === 'not-allowed') error(403);
    // The name stays in the form (UI-10).
    return fail(400, { invalid: true, name: typeof name === 'string' ? name : '' });
  },
  // Makes a profile's invitation link, shown this once (ADR-0010 §5).
  invite: async ({ locals, request, url }) => {
    const context = await householdContext(locals);
    const member = await memberIn(request);
    const result = await invite(context, { member });
    if (result.ok) {
      const link = new URL(`/invitations/${result.token}`, url).href;
      // Drawn from plain values on the page, for a phone in the same room (ADR-0010 §5).
      return { invited: member, link, qr: qrCode(link) };
    }
    if (result.error === 'not-allowed') error(403);
    return fail(404, { notInvitable: true });
  },
  // Revokes a profile's invitation link (ADR-0010 §5).
  revokeInvitation: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const member = await memberIn(request);
    const result = await revokeInvitation(context, { member });
    if (!result.ok) error(403);
    return { revoked: member };
  },
  // Adds a child's profile, with the head's parental consent (ADR-0007 §2, ADR-0010 §9).
  addChild: async ({ locals, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const [name, birthDate] = [form.get('name'), form.get('birthDate')];
    // A ticked checkbox sends `on`; one left empty sends nothing.
    const consent = form.get('consent') === 'on';
    // The sentence the page showed beside the box, in the same language, is what the consent is
    // kept with; never words the browser sends.
    const consentText = { text: m['household.child-consent'](), language: getLocale() };
    const result = await addChild({ ...context, consentText }, { name, birthDate, consent });
    if (result.ok) return { addedChild: result.name };
    if (result.error === 'not-allowed') error(403);
    // What was entered stays in the form (UI-10).
    const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');
    return fail(400, {
      child: { problems: result.problems, name: text(name), birthDate: text(birthDate), consent },
    });
  },
} satisfies Actions;
