import { currentSession, sessionCookie, signInWithPassword, type Cookie } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The security page maps the results of `auth` to its devices, a redirect or a status (TEST-4),
// against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const password = 'correct horse battery staple';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
let next = 0;

/** A new account, signed in on `devices` devices; returns the last one's session. */
const signedIn = async (devices = 1) => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  let cookies: Cookie[] = [];
  for (let i = 0; i < devices; i++) {
    const result = await signInWithPassword(
      test.context,
      { email, password },
      { address: '192.0.2.1', userAgent: firefox },
    );
    if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
    cookies = result.cookies;
  }
  const header = cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`);
  const { session } = await currentSession(
    test.context.auth,
    new Headers({ cookie: header.join('; ') }),
  );
  if (!session) throw new Error('No session');
  return session;
};

const on = { 'sign-in': true };
type Locals = App.Locals;
const loadFor = (locals: Partial<Locals>) =>
  load({ locals: { flags: on, session: null, ...locals } } as unknown as Parameters<
    typeof load
  >[0]);

/** Sends one of the page's forms and returns what came of it. */
const submit = async (
  action: keyof typeof actions,
  session: Locals['session'],
  fields: Record<string, string> = {},
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const set = vi.fn();
  const event = {
    locals: { flags: on, session },
    request: new Request('https://householdr.example.org/security', { method: 'POST', body }),
    cookies: { set },
  } as unknown as Parameters<(typeof actions)[typeof action]>[0];
  try {
    return { returned: await actions[action](event), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

const devicesOf = async (session: Locals['session']) => (await loadFor({ session })).devices;

describe('the security page’s devices (ADR-0010 §6)', () => {
  it('isn’t there while sign-in’s flag is off, and needs a session', async () => {
    const thrown = await loadFor({ flags: { 'sign-in': false } }).catch((e: unknown) => e);
    expect(isHttpError(thrown, 404)).toBe(true);
    const signedOut = await loadFor({}).catch((e: unknown) => e);
    expect(isRedirect(signedOut) && signedOut.location).toBe('/sign-in');
  });

  it('lists the account’s devices, with whole days since each was used', async () => {
    const session = await signedIn(2);
    expect(await devicesOf(session)).toEqual([
      {
        id: session.id,
        browser: 'Firefox',
        system: 'Linux',
        current: true,
        daysSinceUse: expect.any(Number) as number,
      },
      expect.objectContaining({ current: false }),
    ]);
  });

  it('signs another device out, and says so', async () => {
    const session = await signedIn(2);
    const [, other] = await devicesOf(session);
    const { returned } = await submit('signOutDevice', session, { session: other?.id ?? '' });
    expect(returned).toEqual({ done: 'signed-out' });
    expect(await devicesOf(session)).toHaveLength(1);
    const again = await submit('signOutDevice', session, { session: other?.id ?? '' });
    expect(isActionFailure(again.returned) && again.returned).toMatchObject({
      status: 404,
      data: { done: 'not-found' },
    });
  });

  it('signs every other device out', async () => {
    const session = await signedIn(3);
    expect((await submit('signOutOthers', session)).returned).toEqual({
      done: 'signed-out-others',
    });
    expect(await devicesOf(session)).toMatchObject([{ id: session.id }]);
  });

  it('signs this device out, clears its cookie and goes to the sign-in page', async () => {
    const session = await signedIn();
    const { thrown, set } = await submit('signOut', session);
    expect(isRedirect(thrown) && thrown.location).toBe('/sign-in');
    expect(set).toHaveBeenCalledExactlyOnceWith(
      sessionCookie,
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
    expect(await devicesOf(await signedIn())).toHaveLength(1);
  });
});
