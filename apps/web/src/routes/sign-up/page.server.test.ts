import { jobQueue, type JobQueue } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The sign-up route maps the results of `auth` to the page's answer (TEST-4), against a real
// database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
vi.mock('#lib/server/auth.js', () => ({
  authContext: () => Promise.resolve({ ...test.context, queue }),
}));

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

/** Sends the form from `address`, with the flag on unless said otherwise, and returns what came of it. */
const submit = async (email: string, address = '192.0.2.1', flags = { onboarding: true }) => {
  const body = new FormData();
  body.set('email', email);
  const event = {
    locals: { flags },
    request: new Request('https://householdr.example.org/sign-up', { method: 'POST', body }),
    getClientAddress: () => address,
  } as unknown as Parameters<typeof actions.default>[0];
  try {
    return { returned: await actions.default(event) };
  } catch (thrown) {
    return { thrown };
  }
};

/** How many sign-up e-mails are waiting, for anyone. */
const waiting = async () => {
  const { rows } = await test.context.db.$client.query<{ count: number }>(
    "select count(*)::int as count from auth.account_emails where kind = 'sign-up'",
  );
  return rows[0]?.count ?? 0;
};

describe('the sign-up page (ADR-0010 §1)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const off = { onboarding: false };
    expect(() => load({ locals: { flags: off } } as unknown as Parameters<typeof load>[0])).toThrow(
      expect.objectContaining({ status: 404 }) as Error,
    );
    const { thrown } = await submit('person@example.org', '192.0.2.1', off);
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('queues a link for an address without an account', async () => {
    const before = await waiting();
    expect(await submit('new@example.org')).toEqual({
      returned: { email: 'new@example.org', sent: true },
    });
    expect(await waiting()).toBe(before + 1);
  });

  it('answers the same for an address with one, and sends nothing (§1, clarification)', async () => {
    const email = 'robin@example.org';
    await createTestAccount(test.context.auth, { email, password: 'correct horse battery' });
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

  it('says when too many sign-ups came from the network (ADR-0017 §5)', async () => {
    for (let i = 0; i < 10; i++) await submit(`busy-${String(i)}@example.org`, '198.51.100.7');
    const { returned } = await submit('one-more@example.org', '198.51.100.7');
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 429,
      data: { email: 'one-more@example.org', error: 'wait' },
    });
  });
});
