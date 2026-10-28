import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

// The unsubscribe link from an e-mail (ADR-0014 §6) moves its token out of the address bar
// (ADR-0017 §4), and changes nothing else.

const open = (flags = { 'morning-email': true }) => {
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

describe('an unsubscribe link', () => {
  it('isn’t there while the morning e-mail’s flag is off (CODE-20)', () => {
    const { thrown, set } = open({ 'morning-email': false });
    expect(isHttpError(thrown, 404)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps its token in a cookie for this site only, and goes to an address without it', () => {
    const { thrown, set } = open();
    expect(isRedirect(thrown) && thrown).toMatchObject({ status: 303, location: '/unsubscribe' });
    expect(set).toHaveBeenCalledExactlyOnceWith('__Host-householdr.unsubscribe', 'the-token', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60,
    });
  });
});
