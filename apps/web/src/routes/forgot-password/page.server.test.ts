import { recordingLogger } from '@householdr/application/testing';
import { jobQueue, type JobQueue } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The forgotten-password route maps the results of `auth` to the page's answer (TEST-4), against
// a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
vi.mock('#lib/server/auth.js', () => ({
  authContext: () => Promise.resolve({ ...test.context, queue, logger: recordingLogger() }),
}));

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

/** Sends the form, with the flag on unless said otherwise, and returns what came of it. */
const submit = async (email: string, flags = { 'password-reset': true }) => {
  const body = new FormData();
  body.set('email', email);
  const event = {
    locals: { flags },
    request: new Request('https://householdr.example.org/forgot-password', {
      method: 'POST',
      body,
    }),
  } as unknown as Parameters<typeof actions.default>[0];
  try {
    return { returned: await actions.default(event) };
  } catch (thrown) {
    return { thrown };
  }
};

/** How many account e-mails are waiting, for anyone. */
const waiting = async () => {
  const { rows } = await test.context.db.$client.query<{ count: number }>(
    'select count(*)::int as count from auth.account_emails',
  );
  return rows[0]?.count ?? 0;
};

describe('the forgotten-password page (ADR-0010 §8)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const off = { 'password-reset': false };
    expect(() => load({ locals: { flags: off } } as unknown as Parameters<typeof load>[0])).toThrow(
      expect.objectContaining({ status: 404 }) as Error,
    );
    const { thrown } = await submit('person@example.org', off);
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('queues a link for an address with an account', async () => {
    const email = 'robin@example.org';
    await createTestAccount(test.context.auth, { email, password: 'correct horse battery' });
    const before = await waiting();
    expect(await submit(email)).toEqual({ returned: { email, sent: true } });
    expect(await waiting()).toBe(before + 1);
  });

  it('answers the same for an address without one, and sends nothing (ADR-0010 §2)', async () => {
    const email = 'nobody@example.org';
    const before = await waiting();
    expect(await submit(email)).toEqual({ returned: { email, sent: true } });
    expect(await waiting()).toBe(before);
  });

  it('keeps what was typed when it isn’t an e-mail address (UI-10)', async () => {
    const { returned } = await submit('not an address');
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 400,
      data: { email: 'not an address', error: 'invalid' },
    });
  });
});
