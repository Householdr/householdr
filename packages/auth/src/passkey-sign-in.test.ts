import { recordingLogger } from '@householdr/application/testing';
import { jobQueue, sessions, type JobQueue } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cookie } from './cookies';
import { confirmWithPasskey, passkeyChallenge, signInWithPasskey } from './passkey-sign-in';
import { signedInRecently, type PasskeysContext } from './passkeys';
import { currentSession } from './sessions';
import { signInWithPassword } from './sign-in';
import {
  addTestPasskey,
  createTestAccount,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from './testing';

// Signing in, and confirming it's you, with a passkey (ADR-0010 §2, §6), on a real database
// (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: PasskeysContext;

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = { ...test.context, queue, logger: recordingLogger() };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

const site = 'https://householdr.example.org';
const password = 'correct horse battery staple';
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const client = { address: '192.0.2.1', userAgent: firefoxOnLinux };
let next = 0;

type Options = Parameters<TestAuthenticator['authenticate']>[0];

/** Request headers carrying `cookies`, as Firefox on Linux sends them back. */
const headersWith = (...cookies: Cookie[]) =>
  new Headers({
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    'user-agent': firefoxOnLinux,
  });

/** The session `cookies` carry. */
const sessionOf = async (cookies: Cookie[]) => {
  const { session } = await currentSession(test.context.auth, headersWith(...cookies));
  if (!session) throw new Error('No session');
  return session;
};

/** A new account with a passkey on `authenticator`, added while signed in with its password. */
const withPasskey = async (authenticator: TestAuthenticator = testAuthenticator()) => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  const signedIn = await signInWithPassword(test.context, { email, password }, client);
  if (!signedIn.ok) throw new Error(`Not signed in: ${signedIn.error}`);
  const [cookie] = signedIn.cookies;
  if (!cookie) throw new Error('No cookie');
  const session = await sessionOf([cookie]);
  const added = await addTestPasskey(context, session, cookie, client, authenticator);
  if (!added.ok) throw new Error(`No passkey: ${added.error}`);
  return { email, session, cookie, authenticator };
};

/** Signs in with a passkey on `authenticator`, as the sign-in page's endpoints would. */
const signedInWith = async (authenticator: TestAuthenticator, origin = site) => {
  const challenge = await passkeyChallenge(context, new Headers());
  const response = authenticator.authenticate(challenge.options as Options, origin);
  return signInWithPasskey(context, headersWith(...challenge.cookies), { response });
};

describe('signing in with a passkey (ADR-0010 §2)', () => {
  it('signs in to the passkey’s account, on a session named after the device', async () => {
    const person = await withPasskey();
    const result = await signedInWith(person.authenticator);
    if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
    const session = await sessionOf(result.cookies);
    expect(session.accountId).toBe(person.session.accountId);
    expect(session.id).not.toBe(person.session.id);
    const [device] = await test.context.db
      .select({ browser: sessions.browser, system: sessions.system })
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(device).toEqual({ browser: 'Firefox', system: 'Linux' });
  });

  it('asks the browser for any passkey of this site, without naming an account', async () => {
    const challenge = await passkeyChallenge(context, new Headers());
    expect(challenge.options).toMatchObject({ rpId: 'householdr.example.org' });
    expect((challenge.options as Options).allowCredentials ?? []).toEqual([]);
  });

  it('is never slowed down by failed passwords (ADR-0010 §2, clarification)', async () => {
    const person = await withPasskey();
    for (let i = 0; i < 6; i++) {
      await signInWithPassword(test.context, { email: person.email, password: 'wrong' }, client);
    }
    expect(
      await signInWithPassword(test.context, { email: person.email, password }, client),
    ).toMatchObject({ ok: false, error: 'wait' });
    expect(await signedInWith(person.authenticator)).toMatchObject({ ok: true });
  });

  it('refuses a passkey of no account, of another site, or a challenge used already', async () => {
    const unknown = testAuthenticator();
    unknown.register({ challenge: 'never-sent', rp: { id: 'householdr.example.org' } }, site);
    expect(await signedInWith(unknown)).toEqual({ ok: false, error: 'failed' });

    const person = await withPasskey();
    expect(await signedInWith(person.authenticator, 'https://elsewhere.example.org')).toEqual({
      ok: false,
      error: 'failed',
    });

    const challenge = await passkeyChallenge(context, new Headers());
    const response = person.authenticator.authenticate(challenge.options as Options, site);
    const headers = headersWith(...challenge.cookies);
    expect(await signInWithPasskey(context, headers, { response })).toMatchObject({ ok: true });
    expect(await signInWithPasskey(context, headers, { response })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(await signInWithPasskey(context, headersWith(), { response })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(await signInWithPasskey(context, headers, { response: 'not a passkey' })).toEqual({
      ok: false,
      error: 'failed',
    });
  });
});

describe('confirming it’s you with a passkey (ADR-0010 §6)', () => {
  /** Makes the session's sign-in 11 minutes old, by the context's clock. */
  const signedInLongAgo = async (sessionId: string) => {
    const at = new Date(context.clock.now().subtract({ minutes: 11 }).epochMilliseconds);
    await test.context.db.update(sessions).set({ createdAt: at }).where(eq(sessions.id, sessionId));
  };

  it('signs in again with one of the account’s passkeys, in place of the old session', async () => {
    const person = await withPasskey();
    await signedInLongAgo(person.session.id);
    const challenge = await passkeyChallenge(context, headersWith(person.cookie));
    expect((challenge.options as Options).allowCredentials).toHaveLength(1);
    const response = person.authenticator.authenticate(challenge.options as Options, site);
    const headers = headersWith(person.cookie, ...challenge.cookies);
    const result = await confirmWithPasskey(context, person.session, headers, { response });
    if (!result.ok) throw new Error(`Not confirmed: ${result.error}`);
    const session = await sessionOf(result.cookies);
    expect(session.accountId).toBe(person.session.accountId);
    expect(await signedInRecently(context, session)).toBe(true);
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.id, person.session.id)),
    ).toEqual([]);
  });

  it('confirms nothing with another account’s passkey, and ends the session it made', async () => {
    const person = await withPasskey();
    const other = await withPasskey();
    const challenge = await passkeyChallenge(context, new Headers());
    const response = other.authenticator.authenticate(challenge.options as Options, site);
    const headers = headersWith(person.cookie, ...challenge.cookies);
    const othersBefore = await test.context.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, other.session.accountId));
    expect(await confirmWithPasskey(context, person.session, headers, { response })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(
      await test.context.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, other.session.accountId)),
    ).toEqual(othersBefore);
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.id, person.session.id)),
    ).toHaveLength(1);
  });
});
