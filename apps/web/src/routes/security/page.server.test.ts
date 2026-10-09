import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  currentSession,
  sessionCookie,
  signInWithPassword,
  type Cookie,
  type PasskeysContext,
} from '@householdr/auth';
import { addTestPasskey, createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The security page maps the results of `auth` to its devices, a redirect or a status (TEST-4),
// against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: PasskeysContext;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(context) }));
beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = { ...test.context, queue, logger: recordingLogger() };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

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

const on = {
  'sign-in': true,
  'password-reset': false,
  onboarding: false,
  passkeys: false,
  'household-settings': false,
  'activity-log': false,
  shares: false,
  availability: false,
  tasks: false,
  plans: false,
  completions: false,
};
type Locals = App.Locals;
const loadFor = (locals: Partial<Locals>, address = 'https://householdr.example.org/security') =>
  load({
    locals: { flags: on, session: null, ...locals },
    url: new URL(address),
  } as unknown as Parameters<typeof load>[0]);

/** Sends one of the page's forms, with `flags` on, and returns what came of it. */
const submit = async (
  action: keyof typeof actions,
  session: Locals['session'],
  fields: Record<string, string> = {},
  flags: Locals['flags'] = on,
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const set = vi.fn();
  const event = {
    locals: { flags, session },
    request: new Request('https://householdr.example.org/security', {
      method: 'POST',
      body,
      headers: { 'user-agent': firefox },
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

const devicesOf = async (session: Locals['session']) => (await loadFor({ session })).devices;

describe('the security page’s devices (ADR-0010 §6)', () => {
  it('isn’t there while sign-in’s flag is off, and needs a session', async () => {
    const thrown = await loadFor({
      flags: { ...on, 'sign-in': false },
    }).catch((e: unknown) => e);
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

describe('the security page’s passkeys (ADR-0010 §2, §6)', () => {
  const withPasskeys = { ...on, passkeys: true };
  const client = { address: '192.0.2.1', userAgent: firefox };

  /** A new account signed in on one device: its session and the cookie that carries it. */
  const signedInHere = async () => {
    const email = `person-${String(++next)}@example.org`;
    await createTestAccount(test.context.auth, { email, password });
    const result = await signInWithPassword(test.context, { email, password }, client);
    if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
    const [cookie] = result.cookies;
    if (!cookie) throw new Error('No cookie');
    const headers = new Headers({ cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` });
    const { session } = await currentSession(test.context.auth, headers);
    if (!session) throw new Error('No session');
    return { session, cookie };
  };

  /** Makes the session's sign-in older than 10 minutes, by the context's clock. */
  const signedInLongAgo = async (sessionId: string) => {
    const at = new Date(context.clock.now().subtract({ minutes: 11 }).epochMilliseconds);
    await test.context.db.$client.query('update auth.sessions set created_at = $1 where id = $2', [
      at,
      sessionId,
    ]);
  };

  it('aren’t there while their flag is off (CODE-20)', async () => {
    const { session } = await signedInHere();
    expect((await loadFor({ session })).passkeys).toBeNull();
    const { thrown } = await submit('removePasskey', session, { passkey: crypto.randomUUID() });
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('lists the passkeys, named after their device, while changes are open', async () => {
    const { session, cookie } = await signedInHere();
    expect(await addTestPasskey(context, session, cookie, client)).toEqual({ ok: true });
    expect((await loadFor({ session, flags: withPasskeys })).passkeys).toEqual({
      list: [
        {
          id: expect.any(String) as string,
          browser: 'Firefox',
          system: 'Linux',
          daysSinceAdded: expect.any(Number) as number,
        },
      ],
      changeable: true,
    });
  });

  it('removes a passkey, and says so', async () => {
    const { session, cookie } = await signedInHere();
    await addTestPasskey(context, session, cookie, client);
    const passkeys = (await loadFor({ session, flags: withPasskeys })).passkeys;
    const id = passkeys?.list[0]?.id ?? '';
    const removed = await submit('removePasskey', session, { passkey: id }, withPasskeys);
    expect(removed.returned).toEqual({ done: 'passkey-removed' });
    const again = await submit('removePasskey', session, { passkey: id }, withPasskeys);
    expect(isActionFailure(again.returned) && again.returned).toMatchObject({
      status: 404,
      data: { done: 'passkey-not-found' },
    });
  });

  it('asks to confirm it’s you with the password when the sign-in is old (ADR-0010 §6)', async () => {
    const { session, cookie } = await signedInHere();
    await addTestPasskey(context, session, cookie, client);
    await signedInLongAgo(session.id);
    const loaded = await loadFor({ session, flags: withPasskeys });
    expect(loaded.passkeys?.changeable).toBe(false);
    const id = loaded.passkeys?.list[0]?.id ?? '';
    const refused = await submit('removePasskey', session, { passkey: id }, withPasskeys);
    expect(isActionFailure(refused.returned) && refused.returned).toMatchObject({
      status: 403,
      data: { done: 'confirm' },
    });

    const wrong = await submit('confirm', session, { password: 'not the password' }, withPasskeys);
    expect(isActionFailure(wrong.returned) && wrong.returned).toMatchObject({
      status: 400,
      data: { confirm: 'incorrect' },
    });
    // The password never comes back into the page (ADR-0011 §6, clarification).
    expect(JSON.stringify(wrong.returned)).not.toContain('not the password');

    const { thrown, set } = await submit('confirm', session, { password }, withPasskeys);
    expect(isRedirect(thrown) && thrown).toMatchObject({
      status: 303,
      location: '/security?passkeys=confirmed',
    });
    expect(set).toHaveBeenCalledExactlyOnceWith(
      sessionCookie,
      expect.any(String),
      expect.objectContaining({ path: '/', secure: true, httpOnly: true }),
    );
  });

  it('says it’s confirmed only while changes are open', async () => {
    const { session } = await signedInHere();
    const after = 'https://householdr.example.org/security?passkeys=confirmed';
    expect((await loadFor({ session, flags: withPasskeys }, after)).confirmed).toBe(true);
    expect((await loadFor({ session, flags: withPasskeys })).confirmed).toBe(false);
  });
});
