import { currentSession, signInWithPassword } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../+page.server';
import { DELETE, POST } from './+server';

// Turning push on and off for a device through the endpoints, and what the settings page says of
// it (ADR-0014 §7, clarification; TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const publicKey =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', publicKey);
  return () => vi.unstubAllEnvs();
});

const on = { 'sign-in': true, 'notification-preferences': true };
const site = 'https://householdr.example.org';

const password = 'correct horse battery staple';

/**
 * A device signed in to the account at `email`, a new one of its own unless given, as the
 * request's locals.
 */
const device = async (account?: string) => {
  const email = account ?? `robin-${crypto.randomUUID()}@example.org`;
  if (!account) await createTestAccount(test.context.auth, { email, password });
  const result = await signInWithPassword(
    test.context,
    { email, password },
    { address: '192.0.2.1', userAgent: null },
  );
  if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
  const header = result.cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`);
  const { session } = await currentSession(
    test.context.auth,
    new Headers({ cookie: header.join('; ') }),
  );
  if (!session) throw new Error('No session');
  return { email, locals: { flags: on, session } };
};
const subscription = (endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: publicKey, auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
});

/** What the endpoint answers `method` with `body`, from `origin`, or the status it ends in. */
const sent = async (
  handler: typeof POST,
  locals: object,
  body: unknown,
  origin: string | null = site,
) => {
  const request = new Request(`${site}/notification-settings/push`, {
    method: handler === POST ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
  try {
    const response = await handler({
      locals,
      request,
      url: new URL(request.url),
    } as unknown as Parameters<typeof POST>[0]);
    return { status: response.status, body: (await response.json()) as unknown };
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** What the settings page says of push on this device. */
const pushOf = async (locals: object) => {
  const data = await load({ locals } as unknown as Parameters<typeof load>[0]);
  return data.push;
};

describe('push on a device (ADR-0014 §7, clarification)', () => {
  it('is turned on and off for the device in hand, which the settings page shows', async () => {
    const { email, locals } = await device();
    expect(await pushOf(locals)).toEqual({ publicKey, endpoints: [] });
    const own = subscription();
    expect(await sent(POST, locals, own)).toEqual({ status: 200, body: { ok: true } });
    expect(await pushOf(locals)).toEqual({ publicKey, endpoints: [own.endpoint] });
    // Another device of the same account doesn't have it on.
    expect(await pushOf((await device(email)).locals)).toEqual({ publicKey, endpoints: [] });
    expect(await sent(DELETE, locals, { endpoint: own.endpoint })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(await pushOf(locals)).toEqual({ publicKey, endpoints: [] });
  });

  it('refuses an endpoint on another service, and malformed keys (ADR-0017 §6)', async () => {
    const { locals } = await device();
    const elsewhere = subscription('https://push.example.org/send/abc');
    expect(await sent(POST, locals, elsewhere)).toEqual({
      status: 400,
      body: { error: 'invalid' },
    });
    expect(await sent(POST, locals, 'not json')).toEqual({
      status: 400,
      body: { error: 'invalid' },
    });
  });

  it('refuses another site, no session, its flag off, and an instance without push', async () => {
    const { locals } = await device();
    expect(await sent(POST, locals, subscription(), 'https://example.org')).toBe(403);
    expect(await sent(POST, locals, subscription(), null)).toBe(403);
    expect(await sent(POST, { flags: on, session: null }, subscription())).toBe(401);
    const off = { ...locals, flags: { ...on, 'notification-preferences': false } };
    expect(await sent(POST, off, subscription())).toBe(404);
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    expect(await sent(POST, locals, subscription())).toBe(404);
    expect(await pushOf(locals)).toBeNull();
  });
});
