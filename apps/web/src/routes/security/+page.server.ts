import {
  accountPasskeys,
  confirmWithPassword,
  removePasskey,
  signedInDevices,
  signedInRecently,
  signOut,
  signOutDevice,
  signOutOtherDevices,
  type PasskeysContext,
  type Session,
} from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists while sign-in's flag is on (CODE-20), for whoever is signed in. */
function signedIn(locals: App.Locals): Session {
  if (!locals.flags['sign-in']) error(404);
  if (!locals.session) redirect(303, '/sign-in');
  return locals.session;
}

/** Whole days since `then`, so the page needs no time zone. */
const daysSince = (now: Temporal.Instant, then: Temporal.Instant) =>
  Math.floor(now.since(then).total('hours') / 24);

/**
 * The account's passkeys, and whether the sign-in is recent enough to change them; if not, the
 * page asks to confirm it's you first (ADR-0010 §2, §6).
 */
async function passkeysOf(context: PasskeysContext, session: Session) {
  const now = context.clock.now();
  return {
    list: (await accountPasskeys(context, session)).map(({ addedAt, ...passkey }) => ({
      ...passkey,
      daysSinceAdded: daysSince(now, addedAt),
    })),
    changeable: await signedInRecently(context, session),
  };
}

export const load = (async ({ locals, url }) => {
  const session = signedIn(locals);
  const context = await authContext();
  const now = context.clock.now();
  const devices = await signedInDevices(context, session);
  return {
    devices: devices.map(({ lastUsed, ...device }) => ({
      ...device,
      daysSinceUse: daysSince(now, lastUsed),
    })),
    passkeys: locals.flags.passkeys ? await passkeysOf(context, session) : null,
    // After confirming it's you, which starts a new session (ADR-0010 §6).
    confirmed: url.searchParams.get('passkeys') === 'confirmed',
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
  // Confirms it's you with your password, before passkeys change (ADR-0010 §6). The password
  // never comes back into the page (ADR-0011 §6, clarification).
  confirm: async ({ locals, request, cookies, getClientAddress }) => {
    const session = passkeysSession(locals);
    const context = await authContext();
    const result = await confirmWithPassword(
      context,
      session,
      { password: (await request.formData()).get('password') },
      { address: getClientAddress(), userAgent: request.headers.get('user-agent') },
    );
    if (result.ok) {
      for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
      // A new session replaces this one, so the page loads again with it.
      redirect(303, '/security?passkeys=confirmed');
    }
    if (result.error === 'wait') {
      const seconds = result.until.since(context.clock.now()).total('seconds');
      return fail(429, { confirm: result.error, seconds: Math.ceil(seconds) });
    }
    return fail(400, { confirm: result.error });
  },
  removePasskey: async ({ locals, request }) => {
    const session = passkeysSession(locals);
    const form = await request.formData();
    const result = await removePasskey(await authContext(), session, {
      passkey: form.get('passkey'),
    });
    if (result.ok) return { done: 'passkey-removed' as const };
    // Asked to confirm first: the page shows how, once it loads again.
    if (result.error === 'confirm') return fail(403, { done: 'confirm' as const });
    return fail(404, { done: 'passkey-not-found' as const });
  },
} satisfies Actions;
