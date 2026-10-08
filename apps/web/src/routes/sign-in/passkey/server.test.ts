import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  currentSession,
  sessionCookie,
  signInWithPassword,
  type PasskeysContext,
} from '@householdr/auth';
import {
  addTestPasskey,
  createTestAccount,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as verify } from './+server';
import { POST as start } from './options/+server';

// The endpoints of signing in with a passkey (ADR-0010 §2, ADR-0023 §2, clarification) map the
// results of `auth` to JSON and the session's cookie (TEST-4), against a real database (TEST-11).

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

const site = 'https://householdr.example.org';
const password = 'correct horse battery staple';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const client = { address: '192.0.2.1', userAgent: firefox };
const on = {
  'sign-in': true,
  'password-reset': false,
  onboarding: false,
  passkeys: true,
  'household-settings': false,
  'activity-log': false,
  shares: false,
  'two-factor': false,
};
let next = 0;

type Options = Parameters<TestAuthenticator['authenticate']>[0];
type Sent = { name: string; value: string };

/** A new account with a passkey on a test authenticator. */
const withPasskey = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  const signedIn = await signInWithPassword(test.context, { email, password }, client);
  if (!signedIn.ok) throw new Error(`Not signed in: ${signedIn.error}`);
  const [cookie] = signedIn.cookies;
  if (!cookie) throw new Error('No cookie');
  const header = new Headers({ cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` });
  const { session } = await currentSession(test.context.auth, header);
  if (!session) throw new Error('No session');
  const authenticator = testAuthenticator();
  await addTestPasskey(context, session, cookie, client, authenticator);
  return { session, authenticator };
};

/** Calls `endpoint` from `origin` with `cookies` and `body`, and returns what came of it. */
const call = async (
  endpoint: typeof start | typeof verify,
  { origin = site, cookies = [] as Sent[], body = {}, flags = on } = {},
) => {
  const set = vi.fn();
  const path = endpoint === start ? '/sign-in/passkey/options' : '/sign-in/passkey';
  const headers = new Headers({
    origin,
    'user-agent': firefox,
    'content-type': 'application/json',
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
  });
  const event = {
    locals: { flags, session: null },
    request: new Request(`${site}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    url: new URL(`${site}${path}`),
    cookies: { set },
  };
  try {
    // A stand-in for SvelteKit's event, with what the endpoints read.
    return { response: await endpoint(event as never), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

/** The cookies an endpoint set, as the browser sends them back. */
const sent = (set: ReturnType<typeof vi.fn>): Sent[] =>
  (set.mock.calls as [string, string][]).map(([name, value]) => ({ name, value }));

describe('signing in with a passkey through the endpoints', () => {
  it('aren’t there while the passkeys flag is off (CODE-20)', async () => {
    for (const endpoint of [start, verify]) {
      const { thrown } = await call(endpoint, { flags: { ...on, passkeys: false } });
      expect(isHttpError(thrown, 404)).toBe(true);
    }
  });

  it('refuse a request from another site (ADR-0017 §4)', async () => {
    for (const endpoint of [start, verify]) {
      const { thrown } = await call(endpoint, { origin: 'https://elsewhere.example.org' });
      expect(isHttpError(thrown, 403)).toBe(true);
    }
  });

  it('give a challenge for any passkey, then sign in with the one that signed it', async () => {
    const person = await withPasskey();
    const started = await call(start);
    const options = (await started.response?.json()) as Options;
    expect(options).toMatchObject({ rpId: 'householdr.example.org' });
    expect(options.allowCredentials ?? []).toEqual([]);
    const response = person.authenticator.authenticate(options, site);
    const { response: finished, set } = await call(verify, {
      cookies: sent(started.set),
      body: { response },
    });
    expect(finished?.status).toBe(200);
    expect(await finished?.json()).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(
      sessionCookie,
      expect.any(String),
      expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('say when signing in didn’t work, and set no cookie', async () => {
    const { response, set } = await call(verify, { body: { response: 'not a passkey' } });
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'failed' });
    expect(set).not.toHaveBeenCalled();
  });
});
