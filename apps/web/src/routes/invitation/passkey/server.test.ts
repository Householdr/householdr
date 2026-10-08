import { addAdult, createHousehold, invite, membership } from '@householdr/application';
import type { InvitationSignUpContext } from '@householdr/auth';
import {
  createTestAccount,
  signUpLinkTo,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as join } from './+server';
import { POST as start } from './options/+server';

// The endpoints of the WebAuthn steps of joining a household with a new account (ADR-0010 §1, §5;
// ADR-0023 §2, clarification) map the results of `auth` to JSON and cookies (TEST-4), against a
// real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: InvitationSignUpContext;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(context) }));
beforeAll(async () => {
  test = await testSignInContext();
  context = { ...test.context, terms: null };
});
afterAll(() => test.close());

const site = 'https://householdr.example.org';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const on = { 'sign-in': true, 'password-reset': false, onboarding: true, passkeys: true };
const signUpCookie = '__Host-householdr.sign-up';
const invitationCookie = '__Host-householdr.invitation';
const fields = { name: 'Sam', language: 'en' };
let next = 0;

type Sent = { name: string; value: string };

/** Calls `endpoint` from `origin` with `cookies` and `body`, and returns what came of it. */
const call = async (
  endpoint: typeof start | typeof join,
  { origin = site, cookies = [] as Sent[], body = {}, flags = on } = {},
) => {
  const set = vi.fn();
  const deleted = vi.fn();
  const path = endpoint === start ? '/invitation/passkey/options' : '/invitation/passkey';
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

/** The cookies of a sign-up link and of an invitation to Kim's profile in a new household. */
const links = async () => {
  const head = await createTestAccount(test.context.auth, {
    email: `robin-${String(++next)}@example.org`,
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
    {
      db: test.context.db,
      actor: { account: head, twoFactor: true },
      account: { id: head, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  const member = await membership(test.context, head, created.householdId);
  if (!member) throw new Error('Not a member');
  const heads = {
    ...test.context,
    householdId: created.householdId,
    member: { ...member, twoFactor: true },
  };
  const kim = await addAdult(heads, { name: 'Kim' });
  if (!kim.ok) throw new Error('No profile');
  const link = await invite(heads, { member: kim.memberId });
  if (!link.ok) throw new Error('No link');
  const signUp = await signUpLinkTo(test.context, `sam-${String(++next)}@example.org`);
  return {
    householdId: created.householdId,
    cookies: [
      { name: signUpCookie, value: signUp },
      { name: invitationCookie, value: link.token },
    ],
  };
};

describe('joining with a new account through the endpoints', () => {
  it('aren’t there while the onboarding flag is off (CODE-20)', async () => {
    const off = { ...on, onboarding: false };
    for (const endpoint of [start, join]) {
      const { thrown } = await call(endpoint, { cookies: (await links()).cookies, flags: off });
      expect(isHttpError(thrown, 404)).toBe(true);
    }
  });

  it('refuse a request from another site (ADR-0017 §4)', async () => {
    for (const endpoint of [start, join]) {
      const from = { origin: 'https://elsewhere.example.org', cookies: (await links()).cookies };
      const { thrown } = await call(endpoint, { ...from, body: fields });
      expect(isHttpError(thrown, 403)).toBe(true);
    }
  });

  it('give the browser a challenge, then create the account, join and sign in', async () => {
    const { cookies, householdId } = await links();
    const started = await call(start, { cookies, body: fields });
    expect(started.response?.status).toBe(200);
    const options = (await started.response?.json()) as Parameters<
      TestAuthenticator['register']
    >[0];
    const [[name, value]] = started.set.mock.calls as [[string, string, unknown]];
    const response = testAuthenticator().register(options, site);
    const joined = await call(join, {
      cookies: [...cookies, { name, value }],
      body: { ...fields, response },
    });
    expect(joined.response?.status).toBe(200);
    expect(await joined.response?.json()).toEqual({ household: householdId });
    expect((joined.set.mock.calls as [string][]).map(([cookie]) => cookie)).toContain(
      '__Host-householdr.session_token',
    );
    // Both links are used up.
    expect((joined.deleted.mock.calls as [string][]).map(([cookie]) => cookie)).toEqual([
      signUpCookie,
      invitationCookie,
    ]);
  });

  it('say which fields aren’t valid, and which link no longer works', async () => {
    const { cookies } = await links();
    const [signUp, invitation] = cookies as [Sent, Sent];
    for (const endpoint of [start, join]) {
      const refused = await call(endpoint, { cookies, body: { name: '', language: 'en' } });
      expect(refused.response?.status).toBe(400);
      expect(await refused.response?.json()).toEqual({ error: 'invalid', fields: ['name'] });
      const noInvitation = await call(endpoint, {
        cookies: [signUp, { ...invitation, value: 'x'.repeat(43) }],
        body: { ...fields, response: {} },
      });
      expect(await noInvitation.response?.json()).toEqual({ error: 'invitation' });
    }
    const expired = await call(start, {
      cookies: [{ ...signUp, value: 'made-up' }, invitation],
      body: fields,
    });
    expect(await expired.response?.json()).toEqual({ error: 'expired' });
  });
});
