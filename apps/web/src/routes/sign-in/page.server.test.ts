import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The sign-in route maps the results of `auth` to a redirect or form errors (TEST-4), against a
// real database (TEST-11).

type Test = Awaited<ReturnType<typeof testSignInContext>>;
let test: Test;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));

beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const password = 'correct horse battery staple';
let next = 0;
const newAccount = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  return email;
};

/** Sends the form, with the flag on unless said otherwise, and returns what came of it. */
const submit = async (
  fields: Record<string, string>,
  flags = { 'sign-in': true },
  address = 'https://householdr.example.org/sign-in',
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const set = vi.fn();
  const event = {
    locals: { flags },
    request: new Request(address, { method: 'POST', body }),
    url: new URL(address),
    cookies: { set },
    getClientAddress: () => '192.0.2.1',
  } as unknown as Parameters<typeof actions.default>[0];
  try {
    return { returned: await actions.default(event), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

describe('the sign-in page (ADR-0010 §2)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const off = { 'sign-in': false };
    const url = new URL('https://householdr.example.org/sign-in');
    expect(() =>
      load({ locals: { flags: off }, url } as unknown as Parameters<typeof load>[0]),
    ).toThrow(expect.objectContaining({ status: 404 }) as Error);
    const { thrown } = await submit({ email: 'person@example.org', password }, off);
    expect(isHttpError(thrown, 404)).toBe(true);
  });

  it('says the password is changed when a reset sent it here (ADR-0010 §8)', () => {
    const opened = (address: string) =>
      load({
        locals: { flags: { 'sign-in': true } },
        url: new URL(address),
      } as unknown as Parameters<typeof load>[0]);
    expect(opened('https://householdr.example.org/sign-in?password=changed')).toEqual({
      passwordChanged: true,
    });
    expect(opened('https://householdr.example.org/sign-in')).toEqual({ passwordChanged: false });
  });

  it('sets the session’s cookie and goes to the account’s households', async () => {
    const email = await newAccount();
    const { thrown, set } = await submit({ email, password });
    expect(isRedirect(thrown) && thrown).toMatchObject({ status: 303, location: '/' });
    expect(set).toHaveBeenCalledExactlyOnceWith(
      '__Host-householdr.session_token',
      expect.any(String),
      expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('goes back to the invitation it came from, and nowhere else (ADR-0010 §5)', async () => {
    const email = await newAccount();
    const at = (next: string) =>
      submit({ email, password }, undefined, `https://householdr.example.org/sign-in?next=${next}`);
    const back = await at('invitation');
    expect(isRedirect(back.thrown) && back.thrown).toMatchObject({ location: '/invitation' });
    for (const next of ['https://example.com', '//example.com', '/security']) {
      const elsewhere = await at(encodeURIComponent(next));
      expect(isRedirect(elsewhere.thrown) && elsewhere.thrown).toMatchObject({ location: '/' });
    }
  });

  it('keeps the e-mail address but not the password when signing in fails (UI-10)', async () => {
    const email = await newAccount();
    const { returned, set } = await submit({ email, password: 'not the password' });
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 400,
      data: { email, error: 'incorrect' },
    });
    expect(JSON.stringify(returned)).not.toContain('not the password');
    expect(set).not.toHaveBeenCalled();
  });

  it('says in whole seconds how long to wait', async () => {
    const email = await newAccount();
    for (let i = 0; i < 6; i++) await submit({ email, password: 'wrong' });
    test.context.clock.advance({ milliseconds: 300 });
    const { returned } = await submit({ email, password });
    expect(isActionFailure(returned) && returned).toMatchObject({
      status: 429,
      data: { email, error: 'wait', seconds: 1 },
    });
  });
});
