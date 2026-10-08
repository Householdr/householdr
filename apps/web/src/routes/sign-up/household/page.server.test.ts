import { jobQueue, type JobQueue } from '@householdr/application';
import { prepareAccountEmail, requestSignUp } from '@householdr/auth';
import { testSignInContext } from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// The first step of setting up a household knows whether the sign-up link still works (ADR-0010
// §1, clarification), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
const context = () => ({ ...test.context, queue });
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(context()) }));

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

/** The token of a sign-up link to `email`, as the worker would send it. */
const linkTo = async (email: string) => {
  await requestSignUp(context(), { email }, { address: '192.0.2.1' });
  const { rows } = await test.context.db.$client.query<{ id: string }>(
    'select id from auth.account_emails where email = $1',
    [email],
  );
  const prepared = await prepareAccountEmail(test.context, rows[0]?.id ?? '');
  if (prepared?.kind !== 'sign-up') throw new Error('No link');
  return prepared.link.split('/').at(-1) ?? '';
};

/** Opens the page with `token` in the cookie, the flag on unless said otherwise. */
const open = (token: string | undefined, flags = { onboarding: true }) =>
  load({
    locals: { flags },
    cookies: {
      get: (name: string) => (name === '__Host-householdr.sign-up' ? token : undefined),
    },
  } as unknown as Parameters<typeof load>[0]);

describe('setting up a household, from a sign-up link (ADR-0007 §2)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    await expect(open('a-token', { onboarding: false })).rejects.toMatchObject({ status: 404 });
  });

  it('knows the address the link was sent to', async () => {
    const token = await linkTo('new@example.org');
    expect(await open(token)).toEqual({ email: 'new@example.org' });
  });

  it('says when there is no link, or one that doesn’t work', async () => {
    expect(await open(undefined)).toEqual({ email: null });
    expect(await open('made-up')).toEqual({ email: null });
  });
});
