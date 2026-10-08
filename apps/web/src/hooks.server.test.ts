import { createHousehold } from '@householdr/application';
import { sessionCookie, signInWithPassword, type Cookie } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle, ResolveOptions } from '@sveltejs/kit/hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticate, flag, guard, harden, localise } from './hooks.server';

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('./lib/server/auth', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const page = '<html lang="%paraglide.lang%"></html>';

// The hooks run one by one: SvelteKit's `sequence` needs the store of a running server.

/** Runs `hook` on a request for a page, rendering `page` the way SvelteKit would. */
const respond = (
  hook: Handle,
  headers: Record<string, string> = {},
  locals = {},
  cookies: Record<string, string> = {},
  route: string | null = '/',
  params: Record<string, string> = {},
) => {
  const request = new Request('https://householdr.example.org/', { headers });
  return hook({
    event: {
      request,
      url: new URL(request.url),
      route: { id: route },
      params,
      locals,
      cookies: { get: (name: string) => cookies[name], set: vi.fn() },
    } as unknown as RequestEvent,
    resolve: async (_event, options?: ResolveOptions) => {
      const html = (await options?.transformPageChunk?.({ html: page, done: true })) ?? page;
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    },
  });
};

describe('the language of a page (ADR-0016 §1)', () => {
  it('is English, even when the browser asks for Dutch, until Dutch is offered', async () => {
    const response = await respond(localise, { 'accept-language': 'nl-BE,nl;q=0.9' });
    expect(await response.text()).toBe('<html lang="en"></html>');
  });
});

describe('the security headers (ADR-0017 §4)', () => {
  it('are on every response', async () => {
    const headers = (await respond(harden)).headers;
    expect(headers.get('strict-transport-security')).toBe('max-age=63072000');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('keep the camera, and leave passkeys and Web Share at their default', async () => {
    const policy = (await respond(harden)).headers.get('permissions-policy') ?? '';
    const features = Object.fromEntries(
      policy.split(', ').map((entry) => entry.split('=') as [string, string]),
    );
    expect(features.camera).toBe('(self)');
    expect(features.geolocation).toBe('()');
    expect(features.microphone).toBe('()');
    expect(features.payment).toBe('()');
    expect(features).not.toHaveProperty('publickey-credentials-get');
    expect(features).not.toHaveProperty('publickey-credentials-create');
    expect(features).not.toHaveProperty('web-share');
  });

  it('send no referrer to other sites from the pages a token link leads to (§4, clarification)', async () => {
    for (const route of [
      '/reset-password/[token]',
      '/reset-password',
      '/sign-up/[token]',
      '/sign-up/household',
      '/sign-up/household/passkey/options',
      '/sign-up/household/passkey',
      '/invitations/[token]',
      '/invitation',
      '/invitation/passkey/options',
      '/invitation/passkey',
    ]) {
      const headers = (await respond(harden, {}, {}, {}, route)).headers;
      expect(headers.get('referrer-policy')).toBe('same-origin');
    }
    for (const route of ['/forgot-password', '/sign-up']) {
      const elsewhere = (await respond(harden, {}, {}, {}, route)).headers;
      expect(elsewhere.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    }
  });
});

describe('the flags of a request (ADR-0015 §3)', () => {
  it('are evaluated once, at their defaults on an instance without Flipt', async () => {
    const locals = {} as App.Locals;
    await respond(flag, {}, locals);
    expect(locals.flags).toEqual({
      'sign-in': false,
      'password-reset': false,
      onboarding: false,
      passkeys: false,
      'household-settings': false,
      'activity-log': false,
      shares: false,
      'two-factor': false,
    });
  });

  it('can be forced by a test, in the test build (ADR-0015 §10)', async () => {
    const locals = {} as App.Locals;
    await respond(flag, {}, locals, { 'test-flags': 'sign-in=on' });
    expect(locals.flags).toEqual({
      'sign-in': true,
      'password-reset': false,
      onboarding: false,
      passkeys: false,
      'household-settings': false,
      'activity-log': false,
      shares: false,
      'two-factor': false,
    });
  });
});

describe('who a request is signed in as (ADR-0010 §6)', () => {
  /** A cookie as the browser sends it back. */
  const sent = ({ name, value }: Cookie) => `${name}=${encodeURIComponent(value)}`;

  it('is the account of a valid session cookie, with its culture (ADR-0008 §6)', async () => {
    const email = 'robin@example.org';
    const password = 'correct horse battery staple';
    const accountId = await createTestAccount(test.context.auth, { email, password });
    const result = await signInWithPassword(
      test.context,
      { email, password },
      { address: '192.0.2.1', userAgent: null },
    );
    if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
    const [cookie] = result.cookies;
    if (!cookie) throw new Error('No cookie');
    const locals = {} as App.Locals;
    await respond(authenticate, { cookie: sent(cookie) }, locals, {
      [sessionCookie]: cookie.value,
    });
    expect(locals.session).toEqual({
      id: expect.any(String) as string,
      accountId,
      culture: 'en-BE',
    });
  });

  it('is no one without a cookie, or with one that isn’t a session', async () => {
    const locals = {} as App.Locals;
    await respond(authenticate, {}, locals);
    expect(locals.session).toBeNull();
    const forged = { name: sessionCookie, value: 'forged.forged', options: { path: '/' } };
    await respond(authenticate, { cookie: sent(forged) }, locals, { [sessionCookie]: 'forged' });
    expect(locals.session).toBeNull();
  });
});

describe('the guard (ADR-0017 §2)', () => {
  const signedOut = { session: null } as App.Locals;
  const signedIn = { session: { id: 'session', accountId: 'account' } } as App.Locals;
  const outcome = async (
    locals: App.Locals,
    route: string | null,
    params: Record<string, string> = {},
  ) => {
    try {
      return (await respond(guard, {}, locals, {}, route, params)).status;
    } catch (thrown) {
      if (isRedirect(thrown)) return `→ ${thrown.location}`;
      return isHttpError(thrown) ? thrown.status : thrown;
    }
  };

  it('sends a request without a session to the sign-in page, on every route but the open ones', async () => {
    for (const route of ['/security', '/security/passkeys', '/security/passkeys/confirm']) {
      expect(await outcome(signedOut, route)).toBe('→ /sign-in');
    }
    for (const route of [
      '/sign-in',
      '/sign-in/passkey/options',
      '/sign-in/passkey',
      '/sign-in/two-factor',
      '/forgot-password',
      '/reset-password',
      '/reset-password/[token]',
      '/sign-up',
      '/sign-up/[token]',
      '/sign-up/household',
      '/sign-up/household/passkey/options',
      '/sign-up/household/passkey',
      '/invitations/[token]',
      '/invitation',
      '/invitation/passkey/options',
      '/invitation/passkey',
      '/health',
    ]) {
      expect(await outcome(signedOut, route)).toBe(200);
    }
  });

  it('lets a request with a session through', async () => {
    expect(await outcome(signedIn, '/security')).toBe(200);
  });

  it('leaves an address without a route to the error page', async () => {
    expect(await outcome(signedOut, null)).toBe(200);
  });

  describe('in a household', () => {
    const route = '/households/[household]';
    let next = 0;
    /** A new account, signed in, and a household it founded. */
    const founder = async () => {
      const accountId = await createTestAccount(test.context.auth, {
        email: `founder-${String(++next)}@example.org`,
        password: 'correct horse battery staple',
      });
      const result = await createHousehold(
        {
          db: test.context.db,
          actor: { account: accountId, twoFactor: true },
          account: { id: accountId, managed: false, guardians: [] },
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
      if (!result.ok) throw new Error(`No household: ${result.error}`);
      const locals = { session: { id: 'session', accountId } } as App.Locals;
      return { locals, household: result.householdId, member: result.memberId };
    };

    it('lets a member in, as the member they are there', async () => {
      const { locals, household, member } = await founder();
      expect(await outcome(locals, route, { household })).toBe(200);
      expect(locals.membership).toEqual({
        householdId: household,
        member: { id: member, role: 'head', hasAccount: true, twoFactor: false },
      });
    });

    it('is not found for anyone else, whether or not the household exists', async () => {
      const { household } = await founder();
      const { locals } = await founder();
      expect(await outcome(locals, route, { household })).toBe(404);
      expect(await outcome(locals, route, { household: crypto.randomUUID() })).toBe(404);
      expect(await outcome(locals, route, { household: 'not-a-household' })).toBe(404);
      expect(locals.membership).toBeNull();
    });

    it('sends a request without a session to the sign-in page first', async () => {
      const { household } = await founder();
      expect(await outcome(signedOut, route, { household })).toBe('→ /sign-in');
    });
  });
});
