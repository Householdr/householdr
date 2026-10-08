import {
  signedInDevices,
  signOut,
  signOutDevice,
  signOutOtherDevices,
  type Session,
} from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists while sign-in's flag is on (CODE-20), for whoever is signed in. */
function signedIn(locals: App.Locals): Session {
  if (!locals.flags['sign-in']) error(404);
  if (!locals.session) redirect(303, '/sign-in');
  return locals.session;
}

export const load = (async ({ locals }) => {
  const session = signedIn(locals);
  const context = await authContext();
  const now = context.clock.now();
  const devices = await signedInDevices(context, session);
  return {
    devices: devices.map(({ lastUsed, ...device }) => ({
      ...device,
      // Whole days, so the page needs no time zone.
      daysSinceUse: Math.floor(now.since(lastUsed).total('hours') / 24),
    })),
  };
}) satisfies PageServerLoad;

// The changes of the security page's devices (ADR-0010 §6, ADR-0018 §2).
export const actions = {
  signOut: async ({ locals, cookies }) => {
    const session = signedIn(locals);
    const cleared = await signOut(await authContext(), session);
    for (const cookie of cleared) cookies.set(cookie.name, cookie.value, cookie.options);
    redirect(303, '/sign-in');
  },
  signOutDevice: async ({ locals, request }) => {
    const session = signedIn(locals);
    const form = await request.formData();
    const result = await signOutDevice(await authContext(), session, {
      session: form.get('session'),
    });
    if (!result.ok) return fail(404, { done: result.error });
    return { done: 'signed-out' as const };
  },
  signOutOthers: async ({ locals }) => {
    const session = signedIn(locals);
    await signOutOtherDevices(await authContext(), session);
    return { done: 'signed-out-others' as const };
  },
} satisfies Actions;
