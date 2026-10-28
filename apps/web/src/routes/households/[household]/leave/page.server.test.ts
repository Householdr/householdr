import {
  acceptInvitation,
  addAdult,
  createHousehold,
  invite,
  membership,
} from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The leave page maps what a member is asked before leaving to the page, and the form that leaves
// to a redirect or a refusal (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** Ash Lane in Belgium, and Robin, its founding head, as the guard leaves them in the request. */
const founded = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const result = await createHousehold(
    {
      db: test.context.db,
      actor: { account: accountId, twoFactor: true },
      account: { id: accountId, managed: false, guardians: [] },
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
  if (!result.ok) throw new Error(`No household: ${result.error}`);
  const member = await membership(test.context, accountId, result.householdId);
  if (!member) throw new Error('Not a member');
  return { householdId: result.householdId, member };
};

type Membership = Awaited<ReturnType<typeof founded>>;
const on = { flags: { leaving: true } };
/** The same member as the permissions would see them in another role. */
const as = (role: 'adult' | 'child', { householdId, member }: Membership) => ({
  householdId,
  member: { ...member, role },
});

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/**
 * Sends the leave form, choosing `shownAs` and `successor` if given; a redirect comes back as where
 * it goes.
 */
const leave = async (locals: object, shownAs?: string, successor?: string) => {
  const body = new FormData();
  if (shownAs !== undefined) body.set('shownAs', shownAs);
  if (successor !== undefined) body.set('successor', successor);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.default({ locals, request } as unknown as Parameters<
      typeof actions.default
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location };
    throw thrown;
  }
};

describe('the leave page (ADR-0005 §4, ADR-0018 §2, §8)', () => {
  it('shows the household, the member’s name to appear under and the support line', async () => {
    const membership = as('adult', await founded());
    expect(await opened({ ...on, membership })).toEqual({
      household: 'Ash Lane',
      name: 'Robin',
      successors: null,
      support: { name: '1712', phone: '1712', website: 'https://www.1712.be' },
    });
  });

  it('leaves, then goes to the account’s households, which say so', async () => {
    const membership = as('adult', await founded());
    expect(await leave({ ...on, membership }, 'name')).toEqual({ status: 303, location: '/?left' });
    // Gone: the member is a former one, who can't leave again.
    expect(await opened({ ...on, membership })).toBe(403);
  });

  it('asks the last head who becomes head, and passes the role as they leave', async () => {
    const head = await founded();
    // Alex accepts an invitation to their profile, made by Robin with two factors (ADR-0010 §5).
    const context = { ...test.context, ...head, member: { ...head.member, twoFactor: true } };
    const profile = await addAdult(context, { name: 'Alex' });
    if (!profile.ok) throw new Error('No profile');
    const link = await invite(context, { member: profile.memberId });
    if (!link.ok) throw new Error('No link');
    const alexAccount = await createTestAccount(test.context.auth, {
      email: `alex-${crypto.randomUUID()}@example.org`,
      password: 'correct horse battery staple',
    });
    expect(await acceptInvitation(test.context, alexAccount, link.token)).toMatchObject({
      ok: true,
    });
    const loaded = await opened({ ...on, membership: head });
    expect(loaded).toMatchObject({ successors: [{ name: 'Alex' }] });
    const alex = typeof loaded === 'object' ? loaded.successors?.[0]?.id : undefined;
    if (!alex) throw new Error('No successor');
    // Someone who can't become head is refused, and the choices stay chosen (UI-10).
    expect(await leave({ ...on, membership: head }, 'name', crypto.randomUUID())).toMatchObject({
      status: 409,
      data: { problem: 'successor', shownAs: 'name' },
    });
    expect(await leave({ ...on, membership: head }, 'name', alex)).toEqual({
      status: 303,
      location: '/?left',
    });
  });

  it('lets the last head without an adult to pass it to leave, which closes the household', async () => {
    const head = await founded();
    // No one to pass it to: the page warns that leaving closes it (ADR-0018 §2, clarification).
    expect(await opened({ ...on, membership: head })).toMatchObject({ successors: [] });
    expect(await leave({ ...on, membership: head }, 'name', '')).toEqual({
      status: 303,
      location: '/?left',
    });
    expect(await opened({ ...on, membership: head })).toBe(403);
  });

  it('refuses what isn’t a way to be shown (CODE-12)', async () => {
    const head = await founded();
    const adult = as('adult', head);
    expect(await leave({ ...on, membership: adult }, 'nickname')).toMatchObject({
      status: 400,
      data: { problem: 'invalid', shownAs: 'nickname' },
    });
    expect(await leave({ ...on, membership: adult })).toMatchObject({
      status: 400,
      data: { problem: 'invalid', shownAs: null },
    });
  });

  it('is not for a child, who can’t leave on their own (ADR-0010 §10)', async () => {
    const membership = as('child', await founded());
    expect(await opened({ ...on, membership })).toBe(403);
    expect(await leave({ ...on, membership }, 'former member')).toBe(403);
  });

  it('is not found while its flag is off, or for anyone outside the household (CODE-20)', async () => {
    const membership = as('adult', await founded());
    expect(await opened({ flags: { leaving: false }, membership })).toBe(404);
    expect(await leave({ flags: { leaving: false }, membership }, 'name')).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
  });
});
