import { addAdult, createHousehold, invite, membership } from '@householdr/application';
import { createTestAccount, signUpLinkTo, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The page an invitation link leads to maps the invitation to the page, a redirect or a status
// (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const newAccount = () =>
  createTestAccount(test.context.auth, {
    email: `sam-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });

/** Ash Lane, its head's account, and a link for Kim's profile there. */
const invited = async () => {
  const head = await newAccount();
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
  return { head, householdId: created.householdId, token: link.token };
};

/**
 * A request with `token` in the invitation cookie, signed in as `accountId` if given, with
 * `signUpToken` in the sign-up link's cookie if given.
 */
const request = (
  token: string | undefined,
  accountId?: string,
  onboarding = true,
  signUpToken?: string,
) => {
  const deleted = vi.fn();
  const event = {
    locals: {
      flags: { onboarding },
      session: accountId ? { id: 'session', accountId } : null,
    },
    cookies: {
      get: (name: string) =>
        name === '__Host-householdr.invitation'
          ? token
          : name === '__Host-householdr.sign-up'
            ? signUpToken
            : undefined,
      delete: deleted,
    },
  };
  return { event, deleted };
};

const run = async <T>(call: () => Promise<T>) => {
  try {
    return await call();
  } catch (thrown) {
    if (isRedirect(thrown)) return `→ ${thrown.location}`;
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};
const opened = (event: object) => run(() => load(event as Parameters<typeof load>[0]));
const accepted = (event: object) =>
  run(() => actions.accept(event as Parameters<typeof actions.accept>[0]));

describe('the invitation page (ADR-0010 §5)', () => {
  it('isn’t there while onboarding’s flag is off (CODE-20)', async () => {
    const { token } = await invited();
    expect(await opened(request(token, undefined, false).event)).toBe(404);
    expect(await accepted(request(token, undefined, false).event)).toBe(404);
  });

  it('shows what the link invites to, and whether someone is signed in to accept it', async () => {
    const { token } = await invited();
    expect(await opened(request(token).event)).toEqual({
      invitation: { household: 'Ash Lane', profile: 'Kim' },
      signedIn: false,
      signUp: null,
    });
    expect(await opened(request(token, await newAccount()).event)).toMatchObject({
      signedIn: true,
    });
  });

  it('asks someone signed out with a confirmed address to create their account (ADR-0010 §1)', async () => {
    const { token } = await invited();
    const signUpToken = await signUpLinkTo(test.context, 'sam@example.org');
    expect(await opened(request(token, undefined, true, signUpToken).event)).toMatchObject({
      signUp: { email: 'sam@example.org', languages: ['en'], terms: null },
    });
    // Signed in, the account accepts as it is.
    const signedIn = request(token, await newAccount(), true, signUpToken);
    expect(await opened(signedIn.event)).toMatchObject({ signUp: null });
  });

  it('forgets a link that doesn’t work', async () => {
    for (const token of [undefined, 'not-a-link']) {
      const { event, deleted } = request(token);
      expect(await opened(event)).toEqual({ invitation: null, signedIn: false, signUp: null });
      expect(deleted).toHaveBeenCalledWith('__Host-householdr.invitation', expect.anything());
    }
  });

  it('sends someone signed out to sign in, and back here afterwards', async () => {
    const { token } = await invited();
    expect(await accepted(request(token).event)).toBe('→ /sign-in?next=invitation');
  });

  it('joins the household and goes there, forgetting the link', async () => {
    const { token, householdId } = await invited();
    const { event, deleted } = request(token, await newAccount());
    expect(await accepted(event)).toBe(`→ /households/${householdId}`);
    expect(deleted).toHaveBeenCalledWith('__Host-householdr.invitation', expect.anything());
  });

  it('says when the account is already a member, or the link no longer works', async () => {
    const { token, head } = await invited();
    const already = await accepted(request(token, head).event);
    expect(isActionFailure(already) && already).toMatchObject({
      status: 409,
      data: { error: 'member' },
    });
    const gone = await accepted(request('x'.repeat(43), await newAccount()).event);
    expect(isActionFailure(gone) && gone).toMatchObject({
      status: 410,
      data: { error: 'expired' },
    });
  });
});
