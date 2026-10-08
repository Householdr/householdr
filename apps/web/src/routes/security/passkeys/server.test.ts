import { jobQueue, type JobQueue } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  accountPasskeys,
  currentSession,
  signInWithPassword,
  type Cookie,
  type PasskeysContext,
} from '@householdr/auth';
import { createTestAccount, testAuthenticator, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as add } from './+server';
import { POST as start } from './options/+server';

// The endpoints of the WebAuthn steps of adding a passkey (ADR-0010 §2, ADR-0023 §2,
// clarification) map the results of `auth` to JSON (TEST-4), against a real database (TEST-11).

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
const on = {
  'sign-in': true,
  'password-reset': false,
  onboarding: false,
  passkeys: true,
  'household-settings': false,
  'activity-log': false,
  shares: false,
  'two-factor': false,
  tasks: false,
  comparisons: false,
  availability: false,
};
let next = 0;

/** A new account, signed in: its session, and the cookie that carries it. */
const signedIn = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  const client = { address: '192.0.2.1', userAgent: firefox };
  const result = await signInWithPassword(test.context, { email, password }, client);
  if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
  const [cookie] = result.cookies;
  if (!cookie) throw new Error('No cookie');
  const { session } = await currentSession(test.context.auth, headersWith(site, cookie));
  if (!session) throw new Error('No session');
  return { session, cookie };
};

/** Request headers from `origin` carrying `cookies`, as Firefox on Linux sends them. */
const headersWith = (origin: string, ...cookies: Cookie[]) =>
  new Headers({
    origin,
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    'user-agent': firefox,
    'content-type': 'application/json',
  });

/** Calls `endpoint` for `session`, with `headers` and `body`, and returns what came of it. */
const call = async (
  endpoint: typeof start | typeof add,
  { session }: Awaited<ReturnType<typeof signedIn>>,
  headers: Headers,
  body: unknown = {},
  flags: App.Locals['flags'] = on,
) => {
  const set = vi.fn();
  const path = endpoint === start ? '/security/passkeys/options' : '/security/passkeys';
  const event = {
    locals: { flags, session },
    request: new Request(`${site}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    url: new URL(`${site}${path}`),
    cookies: { set },
    getClientAddress: () => '192.0.2.1',
  };
  try {
    // A stand-in for SvelteKit's event, with what the endpoints read.
    return { response: await endpoint(event as never), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

describe('adding a passkey through the endpoints', () => {
  it('aren’t there while the passkeys flag is off (CODE-20)', async () => {
    const person = await signedIn();
    const off = { ...on, passkeys: false };
    for (const endpoint of [start, add]) {
      const { thrown } = await call(endpoint, person, headersWith(site, person.cookie), {}, off);
      expect(isHttpError(thrown, 404)).toBe(true);
    }
  });

  it('refuse a request from another site (ADR-0017 §4)', async () => {
    const person = await signedIn();
    for (const endpoint of [start, add]) {
      const from = headersWith('https://elsewhere.example.org', person.cookie);
      const { thrown } = await call(endpoint, person, from);
      expect(isHttpError(thrown, 403)).toBe(true);
    }
  });

  it('give the browser a challenge, then add the passkey made for it', async () => {
    const person = await signedIn();
    const started = await call(start, person, headersWith(site, person.cookie));
    if (!started.response) throw new Error('No response');
    expect(started.response.status).toBe(200);
    const options = (await started.response.json()) as Parameters<
      ReturnType<typeof testAuthenticator>['register']
    >[0];
    expect(options).toMatchObject({ rp: { id: 'householdr.example.org', name: 'Householdr' } });
    const [[name, value, attributes]] = started.set.mock.calls as [[string, string, unknown]];
    expect(attributes).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    const challenge = { name, value, options: { path: '/' } };

    const response = testAuthenticator().register(options, site);
    const headers = headersWith(site, person.cookie, challenge);
    const added = await call(add, person, headers, { response });
    expect(added.response?.status).toBe(200);
    expect(await added.response?.json()).toEqual({ ok: true });
    expect(await accountPasskeys(context, person.session)).toHaveLength(1);
  });

  it('say when a passkey couldn’t be added', async () => {
    const person = await signedIn();
    const { response } = await call(add, person, headersWith(site, person.cookie), {
      response: 'not a passkey',
    });
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'failed' });
  });

  it('ask to confirm it’s you when the sign-in is old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    const at = new Date(context.clock.now().subtract({ minutes: 11 }).epochMilliseconds);
    await test.context.db.$client.query('update auth.sessions set created_at = $1 where id = $2', [
      at,
      person.session.id,
    ]);
    const { response } = await call(start, person, headersWith(site, person.cookie));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: 'confirm' });
  });
});
