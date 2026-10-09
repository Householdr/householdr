import {
  accountPasskeys,
  accountTwoFactor,
  confirmWithPassword,
  finishTwoFactor,
  removePasskey,
  replaceRecoveryCodes,
  signedInDevices,
  signedInRecently,
  signOut,
  signOutDevice,
  signOutOtherDevices,
  startTwoFactor,
  turnOffTwoFactor,
  type PasskeysContext,
  type Session,
  type TwoFactorSetup,
} from '@householdr/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { passkeysSession } from '#lib/server/passkeys.js';
import { qrCode } from '#lib/server/qr-code.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists while sign-in's flag is on (CODE-20), for whoever is signed in. */
function signedIn(locals: App.Locals): Session {
  if (!locals.flags['sign-in']) error(404);
  if (!locals.session) redirect(303, '/sign-in');
  return locals.session;
}

/** Two-factor exists while signing in and two-factor are released (CODE-20). */
function twoFactorSession(locals: App.Locals): Session {
  if (!locals.flags['sign-in'] || !locals.flags['two-factor']) error(404);
  if (!locals.session) error(401);
  return locals.session;
}

/**
 * The session that confirms it's you, while a way of signing in that needs it is released: passkeys
 * or two-factor (ADR-0010 §6).
 */
function confirmingSession(locals: App.Locals): Session {
  return locals.flags['two-factor'] ? twoFactorSession(locals) : passkeysSession(locals);
}

/** Whole days since `then`, so the page needs no time zone. */
const daysSince = (now: Temporal.Instant, then: Temporal.Instant) =>
  Math.floor(now.since(then).total('hours') / 24);

/** The account's passkeys, named after their device (ADR-0010 §2). */
async function passkeysOf(context: PasskeysContext, session: Session) {
  const now = context.clock.now();
  return (await accountPasskeys(context, session)).map(({ addedAt, ...passkey }) => ({
    ...passkey,
    daysSinceAdded: daysSince(now, addedAt),
  }));
}

/** An authenticator app's setup as the page shows it: a QR code of its URI, and its key. */
const shown = ({ uri, key }: TwoFactorSetup) => ({ qr: qrCode(uri), key });

export const load = (async ({ locals, url }) => {
  const session = signedIn(locals);
  const context = await authContext();
  const now = context.clock.now();
  const devices = await signedInDevices(context, session);
  const twoFactor = await accountTwoFactor(context, session);
  const passkeys = locals.flags.passkeys ? await passkeysOf(context, session) : null;
  return {
    devices: devices.map(({ lastUsed, ...device }) => ({
      ...device,
      daysSinceUse: daysSince(now, lastUsed),
    })),
    passkeys,
    // Nothing about it for an account without a password, whose passkeys are two factors.
    twoFactor: locals.flags['two-factor'] ? twoFactor : null,
    // Changing a way of signing in needs a recent sign-in; an older one confirms it's you first,
    // with a code too while two-factor is on (ADR-0010 §6).
    changeable: await signedInRecently(context, session),
    confirmWithCode: twoFactor?.on ?? false,
    // After confirming it's you, which starts a new session (ADR-0010 §6).
    confirmed: url.searchParams.has('confirmed'),
  };
}) satisfies PageServerLoad;

// The changes of the security page's devices and ways of signing in (ADR-0010 §2, §6, ADR-0018 §2).
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
  // Confirms it's you with your password, and a code while two-factor is on, before a way of
  // signing in changes (ADR-0010 §6). Neither ever comes back into the page (ADR-0011 §6,
  // clarification).
  confirm: async ({ locals, request, cookies, getClientAddress }) => {
    const session = confirmingSession(locals);
    const context = await authContext();
    const form = await request.formData();
    const result = await confirmWithPassword(
      context,
      session,
      { password: form.get('password'), code: form.get('code') },
      { address: getClientAddress(), userAgent: request.headers.get('user-agent') },
    );
    if (result.ok) {
      for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
      // A new session replaces this one, so the page loads again with it.
      redirect(303, '/security?confirmed');
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
    // A head's last two factors, with the reason (ADR-0010 §3).
    if (result.error === 'head') return fail(403, { passkeys: result.error });
    return fail(404, { done: 'passkey-not-found' as const });
  },
  // Starts turning two-factor on: the app's setup, for its first code (ADR-0010 §2).
  startTwoFactor: async ({ locals }) => {
    const session = twoFactorSession(locals);
    const result = await startTwoFactor(await authContext(), session);
    if (result.ok) return { twoFactor: 'setup' as const, setup: shown(result.setup) };
    if (result.error === 'confirm') return fail(403, { done: 'confirm' as const });
    return fail(409, { twoFactor: result.error });
  },
  // Finishes it with the app's first code, and shows the recovery codes this once. The code never
  // comes back into the page (ADR-0011 §6, clarification).
  finishTwoFactor: async ({ locals, request, cookies }) => {
    const session = twoFactorSession(locals);
    const form = await request.formData();
    const result = await finishTwoFactor(await authContext(), session, request.headers, {
      code: form.get('code'),
    });
    if (result.ok) {
      for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
      // The page loads with the session that replaced this one.
      locals.session = result.session;
      return { twoFactor: 'on' as const, recoveryCodes: result.recoveryCodes };
    }
    if (result.error === 'confirm') return fail(403, { done: 'confirm' as const });
    if (result.error === 'incorrect') {
      return fail(400, { twoFactor: result.error, setup: shown(result.setup) });
    }
    return fail(409, { twoFactor: result.error });
  },
  turnOffTwoFactor: async ({ locals }) => {
    const session = twoFactorSession(locals);
    const result = await turnOffTwoFactor(await authContext(), session);
    if (result.ok) return { twoFactor: 'off' as const };
    if (result.error === 'confirm') return fail(403, { done: 'confirm' as const });
    // A head without a passkey, with the reason (ADR-0010 §3).
    return fail(403, { twoFactor: result.error });
  },
  newRecoveryCodes: async ({ locals }) => {
    const session = twoFactorSession(locals);
    const result = await replaceRecoveryCodes(await authContext(), session);
    if (result.ok) return { twoFactor: 'new-codes' as const, recoveryCodes: result.recoveryCodes };
    if (result.error === 'confirm') return fail(403, { done: 'confirm' as const });
    return fail(409, { twoFactor: result.error });
  },
} satisfies Actions;
