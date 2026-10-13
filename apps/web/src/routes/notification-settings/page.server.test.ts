import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The notification settings page maps the account's preferences to the page and its form to the
// use case (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const on = { 'sign-in': true, 'notification-preferences': true };

/** A signed-in account of its own. */
const signedIn = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  return { id: 'a-session', accountId, culture: 'en-BE' };
};

/** What the route does, or the status or redirect it ends in. */
const outcome = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    if (isRedirect(thrown)) return thrown.location;
    throw thrown;
  }
};

const opened = (locals: object) =>
  outcome(() => load({ locals } as unknown as Parameters<typeof load>[0]));

const saved = (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request('https://householdr.example.org/notification-settings', {
    method: 'POST',
    body,
  });
  return outcome(() =>
    actions.save({ locals, request } as unknown as Parameters<typeof actions.save>[0]),
  );
};

/** What the form sends, at version `version`. */
const form = (version: string) => ({
  'plan.published': 'email',
  'plan.drafted': 'app',
  quietStart: '22:00',
  quietEnd: '06:30',
  emailFallback: 'on',
  version,
});

describe('the notification settings page (ADR-0014 §3)', () => {
  it('shows the defaults, saves the form, and shows what was saved', async () => {
    const locals = { flags: on, session: await signedIn() };
    expect(await opened(locals)).toEqual({
      preferences: {
        'plan.published': 'push',
        'plan.drafted': 'push',
        quietStart: '21:30',
        quietEnd: '07:30',
        emailFallback: true,
        version: 0,
      },
      // No push on an instance without a VAPID key (ADR-0014 §7, clarification).
      push: null,
    });
    expect(await saved(locals, form('0'))).toEqual({ saved: true });
    // An unticked box sends nothing, which turns the fallback off.
    const unticked = Object.entries(form('1')).filter(([key]) => key !== 'emailFallback');
    expect(await saved(locals, Object.fromEntries(unticked))).toEqual({ saved: true });
    expect(await opened(locals)).toEqual({
      preferences: {
        'plan.published': 'email',
        'plan.drafted': 'app',
        quietStart: '22:00',
        quietEnd: '06:30',
        emailFallback: false,
        version: 2,
      },
      push: null,
    });
  });

  it('keeps what was entered with the fields that need changing', async () => {
    const locals = { flags: on, session: await signedIn() };
    const result = await saved(locals, { ...form('0'), quietEnd: '22:00' });
    expect(result).toMatchObject({
      status: 400,
      data: { invalid: ['quietEnd'], values: { quietStart: '22:00', quietEnd: '22:00' } },
    });
  });

  it('keeps the choices over a change from another device, at the version saved now', async () => {
    const locals = { flags: on, session: await signedIn() };
    await saved(locals, form('0'));
    const result = await saved(locals, { ...form('0'), 'plan.drafted': 'push' });
    expect(result).toMatchObject({
      status: 409,
      data: {
        values: { 'plan.drafted': 'push', version: 1 },
        conflict: { 'plan.drafted': 'app', emailFallback: true, version: 1 },
      },
    });
  });

  it('isn’t there while its flags are off, and sends whoever isn’t signed in to sign in', async () => {
    const session = await signedIn();
    const off = { ...on, 'notification-preferences': false };
    expect(await opened({ flags: off, session })).toBe(404);
    expect(await saved({ flags: off, session }, form('0'))).toBe(404);
    expect(await opened({ flags: { ...on, 'sign-in': false }, session })).toBe(404);
    expect(await opened({ flags: on, session: null })).toBe('/sign-in');
    expect(await saved({ flags: on, session: null }, form('0'))).toBe('/sign-in');
  });
});
