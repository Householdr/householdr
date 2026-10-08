import { addAdult, createHousehold, invite, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

// The link from a sign-up e-mail (ADR-0010 §1) moves its token out of the address bar (ADR-0017 §4),
// and goes on to one of the two ways in, against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const open = async (flags = { onboarding: true }, invitation?: string) => {
  const set = vi.fn();
  const event = {
    locals: { flags },
    params: { token: 'the-token' },
    cookies: {
      set,
      get: (name: string) => (name === '__Host-householdr.invitation' ? invitation : undefined),
    },
  } as unknown as Parameters<typeof GET>[0];
  try {
    return { returned: await GET(event), set };
  } catch (thrown) {
    return { thrown, set };
  }
};

/** A link to Kim's profile in a new household. */
const invitationLink = async () => {
  const head = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
    {
      db: test.context.db,
      actor: { account: head, twoFactor: true },
      account: { id: head, managed: false, guardians: [] },
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
  if (!created.ok) throw new Error('No household');
  const member = await membership(test.context, head, created.householdId);
  if (!member) throw new Error('Not a member');
  const context = {
    ...test.context,
    householdId: created.householdId,
    member: { ...member, twoFactor: true },
  };
  const kim = await addAdult(context, { name: 'Kim' });
  if (!kim.ok) throw new Error('No profile');
  const link = await invite(context, { member: kim.memberId });
  if (!link.ok) throw new Error('No link');
  return link.token;
};

describe('a sign-up link', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    const { thrown, set } = await open({ onboarding: false });
    expect(isHttpError(thrown, 404)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps its token in a cookie for this site only, and goes on to setting up the household', async () => {
    const { thrown, set } = await open();
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

  it('goes on to joining for someone who opened an invitation that works (ADR-0010 §1, §5)', async () => {
    const invited = await open(undefined, await invitationLink());
    expect(isRedirect(invited.thrown) && invited.thrown).toMatchObject({
      location: '/invitation',
    });
    const stale = await open(undefined, 'x'.repeat(43));
    expect(isRedirect(stale.thrown) && stale.thrown).toMatchObject({
      location: '/sign-up/household',
    });
  });
});
