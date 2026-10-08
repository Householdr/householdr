import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

// The link from a reset e-mail (ADR-0010 §8) moves its token out of the address bar (ADR-0017 §4).

const open = (flags = { 'password-reset': true }) => {
  const set = vi.fn();
  const event = {
    locals: { flags },
    params: { token: 'the-token' },
    cookies: { set },
  } as unknown as Parameters<typeof GET>[0];
  try {
    return { returned: GET(event), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

describe('a reset link', () => {
  it('isn’t there while its flag is off (CODE-20)', () => {
    const { thrown, set } = open({ 'password-reset': false });
    expect(isHttpError(thrown, 404)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps its token in a cookie for this site only, and goes to an address without it', () => {
    const { thrown, set } = open();
    expect(isRedirect(thrown) && thrown).toMatchObject({
      status: 303,
      location: '/reset-password',
    });
    expect(set).toHaveBeenCalledExactlyOnceWith('__Host-householdr.reset', 'the-token', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 60,
    });
  });
});
