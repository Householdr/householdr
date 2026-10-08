import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import { prepareAccountEmail, requestPasswordReset, signInWithPassword } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
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
let next = 0;

/** An account and the token of a reset link for it, as the worker would send it. */
const linked = async () => {
  const email = `person-${String(++next)}@example.org`;
  const id = await createTestAccount(test.context.auth, { email, password });
  await requestPasswordReset(context(), { email });
  const { rows } = await test.context.db.$client.query<{ id: string }>(
    'select id from auth.account_emails where account_id = $1',
    [id],
  );
  const prepared = await prepareAccountEmail(test.context, rows[0]?.id ?? '');
  if (prepared?.kind !== 'password-reset') throw new Error('No link');
  return { email, token: prepared.link.split('/').at(-1) ?? '' };
};

/** Sends the form with `token` in the cookie, the flag on unless said otherwise. */
const submit = async (
  token: string | undefined,
  typed: string,
  flags = { 'password-reset': true },
) => {
  const body = new FormData();
  body.set('password', typed);
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
  (
    await signInWithPassword(
      test.context,
      { email, password: typed },
      { address: '192.0.2.1', userAgent: null },
    )
  ).ok;

describe('the new-password page (ADR-0010 §8)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const off = { 'password-reset': false };
    await expect(opened('token', off)).rejects.toMatchObject({ status: 404 });
    const { thrown } = await submit('token', newPassword, off);
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('says beforehand whether the link still works', async () => {
    const { token } = await linked();
    expect(await opened(token)).toEqual({ link: true });
    expect(await opened('not-a-token')).toEqual({ link: false });
    expect(await opened(undefined)).toEqual({ link: false });
    await submit(token, newPassword);
    expect(await opened(token)).toEqual({ link: false });
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
