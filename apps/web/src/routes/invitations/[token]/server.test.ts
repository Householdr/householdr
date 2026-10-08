import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

// An invitation link (ADR-0010 §5) moves its token out of the address bar (ADR-0017 §4).

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

describe('an invitation link', () => {
  it('isn’t there while onboarding’s flag is off (CODE-20)', () => {
    const { thrown, set } = open({ onboarding: false });
    expect(isHttpError(thrown, 404)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps its token in a cookie for this site only, for 7 days, and shows the invitation', () => {
    const { thrown, set } = open();
    expect(isRedirect(thrown) && thrown).toMatchObject({ status: 303, location: '/invitation' });
    expect(set).toHaveBeenCalledExactlyOnceWith('__Host-householdr.invitation', 'the-token', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });
  });
});
