import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  currentSession,
  sessionCookie,
  signInWithPassword,
  type Cookie,
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
import { POST as confirm } from './+server';
import { POST as start } from './options/+server';

// The endpoints of confirming it's you with a passkey (ADR-0010 §6) map the results of `auth` to
// JSON and the new session's cookie (TEST-4), against a real database (TEST-11).

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
  tasks: false,
};
let next = 0;

type Options = Parameters<TestAuthenticator['authenticate']>[0];
type Sent = Pick<Cookie, 'name' | 'value'>;

/** A new account, signed in, with a passkey on a test authenticator. */
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
  return { session, cookie, authenticator };
};

type Person = Awaited<ReturnType<typeof withPasskey>>;

/** Calls `endpoint` for `person` with `cookies` and `body`, and returns what came of it. */
const call = async (
  endpoint: typeof start | typeof confirm,
  person: Person,
  { cookies = [] as Sent[], body = {}, flags = on } = {},
) => {
  const set = vi.fn();
  const path =
    endpoint === start ? '/security/passkeys/confirm/options' : '/security/passkeys/confirm';
  const headers = new Headers({
    origin: site,
    'user-agent': firefox,
    'content-type': 'application/json',
    cookie: [person.cookie, ...cookies]
      .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
      .join('; '),
  });
  const event = {
    locals: { flags, session: person.session },
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

describe('confirming it’s you with a passkey through the endpoints', () => {
  it('aren’t there while the passkeys flag is off (CODE-20)', async () => {
    const person = await withPasskey();
    for (const endpoint of [start, confirm]) {
      const { thrown } = await call(endpoint, person, { flags: { ...on, passkeys: false } });
      expect(isHttpError(thrown, 404)).toBe(true);
    }
  });

  it('ask only for the account’s own passkeys, and confirm with one of them', async () => {
    const person = await withPasskey();
    const started = await call(start, person);
    const options = (await started.response?.json()) as Options;
    expect(options.allowCredentials).toHaveLength(1);
    const response = person.authenticator.authenticate(options, site);
    const { response: finished, set } = await call(confirm, person, {
      cookies: sent(started.set),
      body: { response },
    });
    expect(finished?.status).toBe(200);
    expect(await finished?.json()).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(sessionCookie, expect.any(String), expect.anything());
  });

  it('confirm nothing with another account’s passkey', async () => {
    const person = await withPasskey();
    const other = await withPasskey();
    const started = await call(start, other);
    const response = other.authenticator.authenticate(
      (await started.response?.json()) as Options,
      site,
    );
    const { response: finished, set } = await call(confirm, person, {
      cookies: sent(started.set),
      body: { response },
    });
    expect(finished?.status).toBe(400);
    expect(await finished?.json()).toEqual({ error: 'failed' });
    expect(set).not.toHaveBeenCalled();
  });
});
