import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

// The link from a sign-up e-mail (ADR-0010 §1) moves its token out of the address bar (ADR-0017 §4).

const open = (flags = { onboarding: true }) => {
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

describe('a sign-up link', () => {
  it('isn’t there while its flag is off (CODE-20)', () => {
    const { thrown, set } = open({ onboarding: false });
    expect(isHttpError(thrown, 404)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps its token in a cookie for this site only, and goes on to setting up the household', () => {
    const { thrown, set } = open();
    expect(isRedirect(thrown) && thrown).toMatchObject({
      status: 303,
      location: '/sign-up/household',
    });
    expect(set).toHaveBeenCalledExactlyOnceWith('__Host-householdr.sign-up', 'the-token', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 60,
    });
  });
});
