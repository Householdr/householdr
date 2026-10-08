import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import { currentSession, signInWithPassword, type Cookie } from '@householdr/auth';
import {
  createTestAccount,
  testSignInContext,
  totpCode,
  turnOnTestTwoFactor,
} from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The step that asks for a code after a right password maps the results of `auth` to a redirect
// or form errors (TEST-4), against a real database (TEST-11).

type Test = Awaited<ReturnType<typeof testSignInContext>>;
let test: Test;
let queue: JobQueue;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

const password = 'correct horse battery staple';
const client = { address: '192.0.2.1', userAgent: null };
let next = 0;
/** Cookies as the browser sends them back. */
const header = (cookies: Cookie[]) =>
  cookies
    .filter(({ value }) => value !== '')
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');

/** An account with two-factor on: its address, the app's key and its recovery codes. */
const withTwoFactor = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  const signedIn = await signInWithPassword(test.context, { email, password }, client);
  if (!signedIn.ok) throw new Error(signedIn.error);
  const cookies = new Headers({ cookie: header(signedIn.cookies) });
  const { session } = await currentSession(test.context.auth, cookies);
  const [cookie] = signedIn.cookies;
  if (!session || !cookie) throw new Error('No session');
  const context = { ...test.context, queue, logger: recordingLogger() };
  return { email, ...(await turnOnTestTwoFactor(context, session, cookie)) };
};

/** The cookie header of a right password for `email`: a step that waits for a code. */
const step = async (email: string) => {
  const result = await signInWithPassword(test.context, { email, password }, client);
  if (result.ok || result.error !== 'needs-code') throw new Error('No code asked');
  return header(result.cookies);
};

const flags = { 'sign-in': true };

const opened = async (cookie: string, on = flags) => {
  try {
    return await load({
      locals: { flags: on },
      request: new Request('https://householdr.example.org/sign-in/two-factor', {
        headers: { cookie },
      }),
    } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    return thrown;
  }
};

/** Sends one of the forms with the step's `cookie`, and returns what came of it. */
const submit = async (
  action: keyof typeof actions,
  cookie: string,
  fields: Record<string, string>,
  on = flags,
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const set = vi.fn();
  const event = {
    locals: { flags: on },
    request: new Request('https://householdr.example.org/sign-in/two-factor', {
      method: 'POST',
      body,
      headers: { cookie },
    }),
    cookies: { set },
    getClientAddress: () => '192.0.2.1',
  } as unknown as Parameters<(typeof actions)[typeof action]>[0];
  try {
    return { returned: await actions[action](event), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

describe('the code step (ADR-0010 §2)', () => {
  it('belongs to signing in, and isn’t there while its flag is off (CODE-20)', async () => {
    const person = await withTwoFactor();
    const cookie = await step(person.email);
    expect(isHttpError(await opened(cookie, { 'sign-in': false }), 404)).toBe(true);
    const { thrown } = await submit('code', cookie, { code: '123456' }, { 'sign-in': false });
    expect(isHttpError(thrown, 404)).toBe(true);
    // An account that turned two-factor on keeps being asked for a code.
    expect(await opened(cookie)).toBeUndefined();
  });

  it('sends back to the password without a step that waits for a code', async () => {
    const thrown = await opened('');
    expect(isRedirect(thrown) && thrown.location).toBe('/sign-in');
  });

  it('signs in with the app’s code, and goes to the account’s households', async () => {
    const person = await withTwoFactor();
    const { thrown, set } = await submit('code', await step(person.email), {
      code: totpCode(person.key),
    });
    expect(isRedirect(thrown) && thrown).toMatchObject({ status: 303, location: '/' });
    expect(set).toHaveBeenCalledWith(
      '__Host-householdr.session_token',
      expect.stringMatching(/.+/),
      expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('signs in with a recovery code', async () => {
    const person = await withTwoFactor();
    const { thrown } = await submit('recoveryCode', await step(person.email), {
      recoveryCode: person.recoveryCodes[0] ?? '',
    });
    expect(isRedirect(thrown) && thrown.location).toBe('/');
  });

  it('says which code was wrong, and never sends it back (ADR-0011 §6)', async () => {
    const person = await withTwoFactor();
    const cookie = await step(person.email);
    const wrong = String((Number(totpCode(person.key)) + 1) % 1_000_000).padStart(6, '0');
    const code = await submit('code', cookie, { code: wrong });
    expect(isActionFailure(code.returned) && code.returned).toMatchObject({
      status: 400,
      data: { field: 'code', error: 'incorrect' },
    });
    expect(JSON.stringify(code.returned)).not.toContain(wrong);
    const recovery = await submit('recoveryCode', cookie, { recoveryCode: 'aaaaa-bbbbb' });
    expect(isActionFailure(recovery.returned) && recovery.returned).toMatchObject({
      status: 400,
      data: { field: 'recoveryCode', error: 'incorrect' },
    });
    expect(JSON.stringify(recovery.returned)).not.toContain('aaaaa');
    expect(code.set).not.toHaveBeenCalled();
  });

  it('says when the step is over, and in whole seconds how long to wait', async () => {
    const person = await withTwoFactor();
    const over = await submit('code', 'a=b', { code: totpCode(person.key) });
    expect(isActionFailure(over.returned) && over.returned).toMatchObject({
      status: 400,
      data: { field: 'code', error: 'expired' },
    });
    for (let tries = 0; tries < 2; tries++) {
      const cookie = await step(person.email);
      for (let i = 0; i < 3; i++)
        await submit('recoveryCode', cookie, { recoveryCode: 'aaaaa-bbbbb' });
    }
    test.context.clock.advance({ milliseconds: 300 });
    const { returned } = await submit('code', await step(person.email), {
      code: totpCode(person.key),
    });
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 429,
      data: { field: 'code', error: 'wait', seconds: 1 },
    });
  });
});
