import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testSignInContext } from '@householdr/auth/testing';
import { actions, load } from './+page.server';

// The unsubscribe page (ADR-0014 §6, clarification): what it does, before anything changes. The
// use cases themselves are tested with real tokens in the application package.

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const on = { flags: { 'morning-email': true } };

/** The page's cookies, holding `token` if given. */
const cookiesWith = (token?: string) => ({
  get: () => token,
  delete: vi.fn(),
});

const opened = async (locals: object, token?: string) => {
  try {
    return await load({ locals, cookies: cookiesWith(token) } as unknown as Parameters<
      typeof load
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const pressed = async (locals: object, token?: string) => {
  const cookies = cookiesWith(token);
  try {
    const result = await actions.default({ locals, cookies } as unknown as Parameters<
      typeof actions.default
    >[0]);
    return { result, cookies };
  } catch (thrown) {
    if (isHttpError(thrown)) return { result: thrown.status, cookies };
    throw thrown;
  }
};

describe('the unsubscribe page', () => {
  it('says a link that doesn’t work no longer does, and changes nothing', async () => {
    expect(await opened(on, 'made-up')).toEqual({ works: false });
    expect(await opened(on)).toEqual({ works: false });
    const { result, cookies } = await pressed(on, 'made-up');
    expect(isActionFailure(result) && result).toMatchObject({
      status: 410,
      data: { expired: true },
    });
    // The cookie goes either way.
    expect(cookies.delete).toHaveBeenCalledOnce();
  });

  it('isn’t there while the morning e-mail’s flag is off (CODE-20)', async () => {
    const off = { flags: { 'morning-email': false } };
    expect(await opened(off, 'a-token')).toBe(404);
    expect((await pressed(off, 'a-token')).result).toBe(404);
  });
});
