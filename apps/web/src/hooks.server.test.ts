import { sessionCookie, signInWithPassword, type Cookie } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
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
) => {
  const request = new Request('https://householdr.example.org/', { headers });
  return hook({
    event: {
      request,
      url: new URL(request.url),
      route: { id: route },
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

  it('send no referrer to other sites from the pages a reset link leads to (§4, clarification)', async () => {
    for (const route of ['/reset-password/[token]', '/reset-password']) {
      const headers = (await respond(harden, {}, {}, {}, route)).headers;
      expect(headers.get('referrer-policy')).toBe('same-origin');
    }
    const elsewhere = (await respond(harden, {}, {}, {}, '/forgot-password')).headers;
    expect(elsewhere.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('the flags of a request (ADR-0015 §3)', () => {
  it('are evaluated once, at their defaults on an instance without Flipt', async () => {
    const locals = {} as App.Locals;
    await respond(flag, {}, locals);
    expect(locals.flags).toEqual({ 'sign-in': false, 'password-reset': false, passkeys: false });
  });

  it('can be forced by a test, in the test build (ADR-0015 §10)', async () => {
    const locals = {} as App.Locals;
    await respond(flag, {}, locals, { 'test-flags': 'sign-in=on' });
    expect(locals.flags).toEqual({ 'sign-in': true, 'password-reset': false, passkeys: false });
  });
});

describe('who a request is signed in as (ADR-0010 §6)', () => {
  /** A cookie as the browser sends it back. */
  const sent = ({ name, value }: Cookie) => `${name}=${encodeURIComponent(value)}`;

  it('is the account of a valid session cookie', async () => {
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
    expect(locals.session).toEqual({ id: expect.any(String) as string, accountId });
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
  const outcome = async (locals: App.Locals, route: string | null) => {
    try {
      return (await respond(guard, {}, locals, {}, route)).status;
    } catch (thrown) {
      return isRedirect(thrown) ? `→ ${thrown.location}` : thrown;
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
      '/forgot-password',
      '/reset-password',
      '/reset-password/[token]',
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
});
