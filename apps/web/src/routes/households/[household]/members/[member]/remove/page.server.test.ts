import { addAdult, createHousehold, membership } from '@householdr/application';
import { currentSession, signInWithPassword } from '@householdr/auth';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The page where a head removes a member maps who is removed, and whether the head confirms it is
// them first, to the page, and the form to a redirect or a refusal (TEST-4), against a real
// database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const password = 'correct horse battery staple';

/**
 * Ash Lane, founded by Robin, signed in `minutesAgo` minutes ago by the test clock, as a head with
 * two factors, with Sam, a profile without an account, as the guard leaves them in the request.
 */
const founded = async (minutesAgo = 1) => {
  const email = `robin-${crypto.randomUUID()}@example.org`;
  const accountId = await createTestAccount(test.context.auth, { email, password });
  const signedIn = await signInWithPassword(
    test.context,
    { email, password },
    { address: '192.0.2.1', userAgent: 'Firefox' },
  );
  if (!signedIn.ok) throw new Error('Not signed in');
  const header = signedIn.cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`);
  const { session } = await currentSession(
    test.context.auth,
    new Headers({ cookie: header.join('; ') }),
  );
  if (!session) throw new Error('No session');
  const at = new Date(test.context.clock.now().subtract({ minutes: minutesAgo }).epochMilliseconds);
  await test.context.db.$client.query('update auth.sessions set created_at = $1 where id = $2', [
    at,
    session.id,
  ]);
  const created = await createHousehold(
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
  if (!created.ok) throw new Error('No household');
  const { householdId } = created;
  const member = await membership(test.context, accountId, householdId);
  if (!member) throw new Error('Not a member');
  const head = { ...member, twoFactor: true };
  const { db, clock } = test.context;
  const sam = await addAdult({ db, clock, householdId, member: head }, { name: 'Sam' });
  if (!sam.ok) throw new Error('No Sam');
  const locals = {
    flags: { 'removing-members': true },
    session,
    membership: { householdId, member: head },
  };
  return { locals, householdId, sam: sam.memberId };
};

const opened = async (locals: object, member: string) => {
  try {
    return await load({ locals, params: { member } } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the removal; a redirect comes back as where it goes. */
const remove = async (locals: object, household: string, member: string) => {
  try {
    return await actions.default({ locals, params: { household, member } } as unknown as Parameters<
      typeof actions.default
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location };
    throw thrown;
  }
};

describe('removing a member (ADR-0005 §4, ADR-0018 §4)', () => {
  it('asks a head to confirm, then removes, and goes back to the household', async () => {
    const { locals, householdId, sam } = await founded();
    expect(await opened(locals, sam)).toEqual({
      household: 'Ash Lane',
      name: 'Sam',
      role: 'adult',
      confirm: false,
    });
    expect(await remove(locals, householdId, sam)).toEqual({
      status: 303,
      location: `/households/${householdId}?removed`,
    });
    expect(await opened(locals, sam)).toBe(404);
  });

  it('asks to confirm it’s them first after an old sign-in, and removes nothing (ADR-0010 §6)', async () => {
    const { locals, householdId, sam } = await founded(11);
    expect(await opened(locals, sam)).toMatchObject({ confirm: true });
    expect(await remove(locals, householdId, sam)).toEqual({
      status: 303,
      location: `/households/${householdId}/members/${sam}/remove`,
    });
    expect(await opened(locals, sam)).toMatchObject({ name: 'Sam' });
  });

  it('is only for heads, never on themselves, and not found while its flag is off', async () => {
    const { locals, householdId, sam } = await founded();
    const head = locals.membership.member;
    const adult = { ...locals, membership: { householdId, member: { ...head, role: 'adult' } } };
    expect(await opened(adult, sam)).toBe(403);
    expect(await remove(adult, householdId, sam)).toBe(403);
    expect(await opened(locals, head.id)).toBe(403);
    expect(await opened(locals, crypto.randomUUID())).toBe(404);
    const off = { ...locals, flags: { 'removing-members': false } };
    expect(await opened(off, sam)).toBe(404);
    expect(await remove(off, householdId, sam)).toBe(404);
  });
});
