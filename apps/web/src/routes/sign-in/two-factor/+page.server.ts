import { codeAwaited, signInWithCode } from '@householdr/auth';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The step after a right password, for an account with two-factor on (ADR-0010 §2). It belongs to
 * signing in, so it exists while sign-in's flag is on: only an account that turned two-factor on,
 * which its own flag allows, ever gets here, and it keeps being asked for a code (CODE-20).
 */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['sign-in']) error(404);
}

export const load: PageServerLoad = async ({ locals, request }) => {
  needsFlag(locals);
  // Without a step that waits for a code, signing in starts with the password.
  if (!(await codeAwaited(await authContext(), request.headers))) redirect(303, '/sign-in');
};

/** What the code forms send, by name: a code from the app, or a recovery code. */
type Field = 'code' | 'recoveryCode';

/**
 * Signs in with the code in `field`, and goes where a password sign-in goes. Codes never come back
 * into the page (ADR-0011 §6, clarification).
 */
async function signInWith(field: Field, { locals, request, cookies }: RequestEvent) {
  needsFlag(locals);
  const form = await request.formData();
  const context = await authContext();
  const result = await signInWithCode(context, request.headers, { [field]: form.get(field) });
  if (result.ok) {
    for (const cookie of result.cookies) cookies.set(cookie.name, cookie.value, cookie.options);
    // The account's household, or the list of them (ADR-0005 §1).
    redirect(303, '/');
  }
  if (result.error === 'wait') {
    const seconds = result.until.since(context.clock.now()).total('seconds');
    return fail(429, { field, error: result.error, seconds: Math.ceil(seconds) });
  }
  return fail(400, { field, error: result.error });
}

export const actions = {
  code: (event) => signInWith('code', event),
  recoveryCode: (event) => signInWith('recoveryCode', event),
} satisfies Actions;
