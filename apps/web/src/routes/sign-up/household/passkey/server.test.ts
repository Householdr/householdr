import type { HouseholdSignUpContext } from '@householdr/auth';
import {
  signUpLinkTo,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as create } from './+server';
import { POST as start } from './options/+server';

// The endpoints of the WebAuthn steps of creating a household (ADR-0007 §2, ADR-0023 §2,
// clarification) map the results of `auth` to JSON and cookies (TEST-4), against a real database
// (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: HouseholdSignUpContext;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(context) }));
beforeAll(async () => {
  test = await testSignInContext();
  context = { ...test.context, terms: null };
});
afterAll(() => test.close());

const site = 'https://householdr.example.org';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const on = {
  'sign-in': true,
  'password-reset': false,
  onboarding: true,
  passkeys: true,
  'household-settings': false,
  'activity-log': false,
  shares: false,
  'two-factor': false,
  tasks: false,
  comparisons: false,
  availability: false,
};
const signUpCookie = '__Host-householdr.sign-up';
let next = 0;

const fields = {
  name: 'Ash Lane',
  headName: 'Robin',
  country: 'BE',
  timeZone: 'Europe/Brussels',
  language: 'en',
  headLanguage: 'en',
  weekStartDay: 1,
  adult: true,
};

type Sent = { name: string; value: string };

/** Calls `endpoint` from `origin` with `cookies` and `body`, and returns what came of it. */
const call = async (
  endpoint: typeof start | typeof create,
  { origin = site, cookies = [] as Sent[], body = {}, flags = on } = {},
) => {
  const set = vi.fn();
  const deleted = vi.fn();
  const path =
    endpoint === start ? '/sign-up/household/passkey/options' : '/sign-up/household/passkey';
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
    cookies: {
      get: (name: string) => cookies.find((cookie) => cookie.name === name)?.value,
      set,
      delete: deleted,
    },
  };
  try {
    // A stand-in for SvelteKit's event, with what the endpoints read.
    return { response: await endpoint(event as never), set, deleted };
  } catch (thrown) {
    return { thrown, set, deleted };
  }
};

/** A sign-up link's cookie, as the link's own address sets it. */
const linkCookie = async () => ({
  name: signUpCookie,
  value: await signUpLinkTo(test.context, `person-${String(++next)}@example.org`),
});

describe('creating a household through the endpoints', () => {
  it('aren’t there while the onboarding flag is off (CODE-20)', async () => {
    const off = { ...on, onboarding: false };
    for (const endpoint of [start, create]) {
      const { thrown } = await call(endpoint, { cookies: [await linkCookie()], flags: off });
      expect(isHttpError(thrown, 404)).toBe(true);
    }
  });

  it('refuse a request from another site (ADR-0017 §4)', async () => {
    for (const endpoint of [start, create]) {
      const from = { origin: 'https://elsewhere.example.org', cookies: [await linkCookie()] };
      const { thrown } = await call(endpoint, { ...from, body: fields });
      expect(isHttpError(thrown, 403)).toBe(true);
    }
  });

  it('give the browser a challenge, then create the household and sign in', async () => {
    const link = await linkCookie();
    const started = await call(start, { cookies: [link], body: fields });
    expect(started.response?.status).toBe(200);
    const options = (await started.response?.json()) as Parameters<
      TestAuthenticator['register']
    >[0];
    expect(options).toMatchObject({ rp: { id: 'householdr.example.org', name: 'Householdr' } });
    const [[name, value, attributes]] = started.set.mock.calls as [[string, string, unknown]];
    expect(attributes).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'lax' });

    const response = testAuthenticator().register(options, site);
    const created = await call(create, {
      cookies: [link, { name, value }],
      body: { ...fields, response },
    });
    expect(created.response?.status).toBe(200);
    expect(await created.response?.json()).toEqual({ ok: true });
    // Signed in, and the used-up link's cookie is gone (ADR-0010 §1, clarification).
    expect((created.set.mock.calls as [string][]).map(([cookie]) => cookie)).toContain(
      '__Host-householdr.session_token',
    );
    expect(created.deleted).toHaveBeenCalledExactlyOnceWith(signUpCookie, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 60,
    });
  });

  it('say which fields aren’t valid, and when the link no longer works', async () => {
    const link = await linkCookie();
    for (const endpoint of [start, create]) {
      const { response, deleted } = await call(endpoint, {
        cookies: [link],
        body: { ...fields, name: '', adult: false },
      });
      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({ error: 'invalid', fields: ['name', 'adult'] });
      expect(deleted).not.toHaveBeenCalled();
      const expired = await call(endpoint, {
        cookies: [{ name: signUpCookie, value: 'made-up' }],
        body: { ...fields, response: {} },
      });
      expect(expired.response?.status).toBe(400);
      expect(await expired.response?.json()).toEqual({ error: 'expired' });
    }
  });

  it('say when the passkey wasn’t made for the challenge', async () => {
    const { response } = await call(create, {
      cookies: [await linkCookie()],
      body: { ...fields, response: 'not a passkey' },
    });
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'failed' });
  });
});
