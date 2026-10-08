import { sessions } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cookie } from './cookies';
import {
  currentSession,
  sessionCookie,
  signedInDevices,
  signOut,
  signOutDevice,
  signOutOtherDevices,
  type Session,
} from './sessions';
import { signInWithPassword } from './sign-in';
import { createTestAccount, testSignInContext } from './testing';

// The sessions of an account, as the request hook and the security page use them (ADR-0010 §6), on
// a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const password = 'correct horse battery staple';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const safari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
let next = 0;

const newAccount = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  return email;
};

/** The `Cookie` header a browser sends back for `cookies`. */
const cookieHeader = (cookies: Cookie[]) =>
  new Headers({
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
  });

/** Signs in to `email` from a browser, and returns the session and its cookies. */
const signIn = async (email: string, userAgent = firefox) => {
  const result = await signInWithPassword(
    test.context,
    { email, password },
    { address: '192.0.2.1', userAgent },
  );
  if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
  const { session } = await currentSession(test.context.auth, cookieHeader(result.cookies));
  if (!session) throw new Error('No session');
  return { session, cookies: result.cookies };
};

const exists = async (session: Session) =>
  (await test.context.db.select().from(sessions).where(eq(sessions.id, session.id))).length > 0;

describe('currentSession (ADR-0010 §6)', () => {
  it('finds who the cookie belongs to', async () => {
    const email = await newAccount();
    const { session, cookies } = await signIn(email);
    expect(cookies.map(({ name }) => name)).toEqual([sessionCookie]);
    const found = await currentSession(test.context.auth, cookieHeader(cookies));
    expect(found.session).toEqual(session);
  });

  it('finds no one without a valid session', async () => {
    expect((await currentSession(test.context.auth, new Headers())).session).toBeNull();
    const forged = cookieHeader([
      { name: sessionCookie, value: 'not-a-token.not-a-signature', options: { path: '/' } },
    ]);
    expect((await currentSession(test.context.auth, forged)).session).toBeNull();
  });
});

describe('the signed-in devices of an account (ADR-0010 §6)', () => {
  it('lists this device first, by browser and system, and no one else’s', async () => {
    const email = await newAccount();
    await signIn(email, safari);
    const { session } = await signIn(email, firefox);
    await signIn(await newAccount());
    const devices = await signedInDevices(test.context, session);
    expect(devices).toMatchObject([
      { id: session.id, browser: 'Firefox', system: 'Linux', current: true },
      { browser: 'Safari', system: 'iOS', current: false },
    ]);
  });

  it('leaves out sessions that have expired', async () => {
    const email = await newAccount();
    const { session } = await signIn(email);
    const later = test.context.clock.now().add({ hours: 31 * 24 });
    const devices = await signedInDevices(
      { ...test.context, clock: { now: () => later } },
      session,
    );
    expect(devices).toEqual([]);
  });
});

describe('signing devices out (ADR-0010 §6, ADR-0018 §2)', () => {
  it('signs one of the account’s other devices out', async () => {
    const email = await newAccount();
    const phone = await signIn(email, safari);
    const { session } = await signIn(email);
    expect(await signOutDevice(test.context, session, { session: phone.session.id })).toEqual({
      ok: true,
    });
    expect(await exists(phone.session)).toBe(false);
    expect(await exists(session)).toBe(true);
  });

  it('never signs out another account’s device', async () => {
    const { session } = await signIn(await newAccount());
    const someoneElse = await signIn(await newAccount());
    expect(await signOutDevice(test.context, session, { session: someoneElse.session.id })).toEqual(
      { ok: false, error: 'not-found' },
    );
    expect(await exists(someoneElse.session)).toBe(true);
    expect(await signOutDevice(test.context, session, { session: 'robin' })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('signs every other device out, and keeps this one', async () => {
    const email = await newAccount();
    const phone = await signIn(email, safari);
    const tablet = await signIn(email, safari);
    const { session } = await signIn(email);
    const someoneElse = await signIn(await newAccount());
    await signOutOtherDevices(test.context, session);
    expect(await exists(phone.session)).toBe(false);
    expect(await exists(tablet.session)).toBe(false);
    expect(await exists(session)).toBe(true);
    expect(await exists(someoneElse.session)).toBe(true);
  });

  it('signs this device out, and clears its cookie', async () => {
    const email = await newAccount();
    const { session, cookies } = await signIn(email);
    expect(await signOut(test.context, session)).toEqual([
      {
        name: sessionCookie,
        value: '',
        options: { path: '/', maxAge: 0, secure: true, httpOnly: true, sameSite: 'lax' },
      },
    ]);
    expect(await exists(session)).toBe(false);
    expect((await currentSession(test.context.auth, cookieHeader(cookies))).session).toBeNull();
  });
});
