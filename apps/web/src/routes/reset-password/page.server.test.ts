import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  currentSession,
  prepareAccountEmail,
  requestPasswordReset,
  signInWithPassword,
} from '@householdr/auth';
import {
  createTestAccount,
  testSignInContext,
  totpCode,
  turnOnTestTwoFactor,
} from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The new-password route maps the results of `auth` to a redirect or form errors (TEST-4), against
// a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let breach: 'breached' | 'not-breached' = 'not-breached';
const context = () => ({
  ...test.context,
  queue,
  logger: recordingLogger(),
  checkBreach: () => Promise.resolve(breach),
});
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(context()) }));

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});
beforeEach(() => {
  breach = 'not-breached';
});

const cookie = '__Host-householdr.reset';
const password = 'correct horse battery staple';
const newPassword = 'a whole new password';
const client = { address: '192.0.2.1', userAgent: null };
let next = 0;

/**
 * An account and the token of a reset link for it, as the worker would send it, with two-factor on
 * if `twoFactor`: then also the app's key and the recovery codes.
 */
const linked = async (twoFactor = false) => {
  const email = `person-${String(++next)}@example.org`;
  const id = await createTestAccount(test.context.auth, { email, password });
  const { key, recoveryCodes } = twoFactor ? await turnOn(email) : { key: '', recoveryCodes: [] };
  await requestPasswordReset(context(), { email });
  const { rows } = await test.context.db.$client.query<{ id: string }>(
    "select id from auth.account_emails where account_id = $1 and kind = 'password-reset'",
    [id],
  );
  const prepared = await prepareAccountEmail(test.context, rows[0]?.id ?? '');
  if (prepared?.kind !== 'password-reset') throw new Error('No link');
  return { email, token: prepared.link.split('/').at(-1) ?? '', key, recoveryCodes };
};

/** Turns two-factor on for the account at `email`, as its security page does. */
async function turnOn(email: string) {
  const signedIn = await signInWithPassword(test.context, { email, password }, client);
  const sessionCookie = signedIn.ok ? signedIn.cookies[0] : undefined;
  if (!sessionCookie) throw new Error('Not signed in');
  const { name, value } = sessionCookie;
  const headers = new Headers({ cookie: `${name}=${encodeURIComponent(value)}` });
  const { session } = await currentSession(test.context.auth, headers);
  if (!session) throw new Error('No session');
  return turnOnTestTwoFactor(context(), session, sessionCookie);
}

/**
 * Sends the form with `token` in the cookie, and `code` when given, the flag on unless said
 * otherwise.
 */
const submit = async (
  token: string | undefined,
  typed: string,
  flags = { 'password-reset': true },
  code?: string,
) => {
  const body = new FormData();
  body.set('password', typed);
  if (code !== undefined) body.set('code', code);
  const remove = vi.fn();
  const event = {
    locals: { flags },
    request: new Request('https://householdr.example.org/reset-password', {
      method: 'POST',
      body,
    }),
    cookies: { get: (name: string) => (name === cookie ? token : undefined), delete: remove },
  } as unknown as Parameters<typeof actions.default>[0];
  try {
    return { returned: await actions.default(event), remove };
  } catch (thrown) {
    return { thrown, remove };
  }
};

const opened = (token: string | undefined, flags = { 'password-reset': true }) =>
  load({
    locals: { flags },
    cookies: { get: (name: string) => (name === cookie ? token : undefined) },
  } as unknown as Parameters<typeof load>[0]);

const signsIn = async (email: string, typed: string) =>
  (await signInWithPassword(test.context, { email, password: typed }, client)).ok;

describe('the new-password page (ADR-0010 §8)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const off = { 'password-reset': false };
    await expect(opened('token', off)).rejects.toMatchObject({ status: 404 });
    const { thrown } = await submit('token', newPassword, off);
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('says beforehand whether the link still works', async () => {
    const { token } = await linked();
    expect(await opened(token)).toEqual({ link: true, code: false });
    expect(await opened('not-a-token')).toEqual({ link: false, code: false });
    expect(await opened(undefined)).toEqual({ link: false, code: false });
    await submit(token, newPassword);
    expect(await opened(token)).toEqual({ link: false, code: false });
  });

  it('saves the new password, forgets the link and goes to the sign-in page', async () => {
    const { email, token } = await linked();
    const { thrown, remove } = await submit(token, newPassword);
    expect(isRedirect(thrown) && thrown).toMatchObject({
      status: 303,
      location: '/sign-in?password=changed',
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith(cookie, expect.objectContaining({ path: '/' }));
    expect(await signsIn(email, newPassword)).toBe(true);
    expect(await signsIn(email, password)).toBe(false);
  });

  it('keeps the link when the password is refused, and never sends it back (ADR-0011 §6)', async () => {
    const { email, token } = await linked();
    const short = await submit(token, 'too short');
    expect(isActionFailure(short.returned) && short.returned).toMatchObject({
      status: 400,
      data: { error: 'too-short' },
    });
    expect(JSON.stringify(short.returned)).not.toContain('too short');
    expect(short.remove).not.toHaveBeenCalled();
    breach = 'breached';
    const breached = await submit(token, newPassword);
    expect(isActionFailure(breached.returned) && breached.returned).toMatchObject({
      status: 400,
      data: { error: 'breached' },
    });
    expect(await signsIn(email, password)).toBe(true);
  });

  it('forgets a link that has expired or was used', async () => {
    const { token } = await linked();
    await submit(token, newPassword);
    for (const used of [token, 'not-a-token']) {
      const { returned, remove } = await submit(used, 'another new password');
      expect(isActionFailure(returned) && returned).toMatchObject({
        status: 400,
        data: { error: 'expired' },
      });
      expect(remove).toHaveBeenCalledOnce();
    }
  });
});

describe('the new-password page with two-factor on (ADR-0010 §8)', () => {
  const on = { 'password-reset': true };
  const wrongCode = (key: string) =>
    String((Number(totpCode(key, test.context.clock.now())) + 1) % 1_000_000).padStart(6, '0');

  it('asks for a code, once the link is known to work', async () => {
    const { token } = await linked(true);
    expect(await opened(token)).toEqual({ link: true, code: true });
    expect(await opened('not-a-token')).toEqual({ link: false, code: false });
  });

  it('keeps the link without a code, or with a wrong one, and never sends it back', async () => {
    const { email, token, key } = await linked(true);
    const missing = await submit(token, newPassword, on, '');
    expect(isActionFailure(missing.returned) && missing.returned).toMatchObject({
      status: 400,
      data: { error: 'needs-code' },
    });
    const wrong = wrongCode(key);
    const refused = await submit(token, newPassword, on, wrong);
    expect(isActionFailure(refused.returned) && refused.returned).toMatchObject({
      status: 400,
      data: { error: 'incorrect-code' },
    });
    expect(JSON.stringify(refused.returned)).not.toContain(wrong);
    expect(JSON.stringify(refused.returned)).not.toContain(newPassword);
    for (const { remove } of [missing, refused]) expect(remove).not.toHaveBeenCalled();
    expect(await opened(token)).toEqual({ link: true, code: true });
    // The old password is still the one: it gets as far as the code.
    expect(await signInWithPassword(test.context, { email, password }, client)).toMatchObject({
      error: 'needs-code',
    });
  });

  it('saves the new password with a recovery code, and goes to the sign-in page', async () => {
    const { token, recoveryCodes } = await linked(true);
    const { thrown, remove } = await submit(token, newPassword, on, recoveryCodes[0]);
    expect(isRedirect(thrown) && thrown).toMatchObject({
      status: 303,
      location: '/sign-in?password=changed',
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('says in whole seconds how long to wait after wrong codes', async () => {
    const { token, key } = await linked(true);
    for (let i = 0; i < 6; i++) await submit(token, newPassword, on, wrongCode(key));
    test.context.clock.advance({ milliseconds: 300 });
    const { returned, remove } = await submit(
      token,
      newPassword,
      on,
      totpCode(key, test.context.clock.now()),
    );
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 429,
      data: { error: 'wait', seconds: 1 },
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
