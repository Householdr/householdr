import { createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// A household's page maps what its members see to the page, or to a status (TEST-4), against a
// real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household and its founding head, as the guard leaves them in the request (ADR-0017 §2). */
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

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('a household’s page (ADR-0007 §1)', () => {
  it('shows the household’s name and members, and which one is you', async () => {
    const membership = await founded();
    expect(await opened({ flags: { onboarding: true }, membership })).toEqual({
      name: 'Ash Lane',
      members: [{ id: membership.member.id, name: 'Robin', role: 'head' }],
      you: membership.member.id,
    });
  });

  it('is not found until onboarding’s flag is on (CODE-20), or outside a household', async () => {
    const membership = await founded();
    expect(await opened({ flags: { onboarding: false }, membership })).toBe(404);
    expect(await opened({ flags: { onboarding: true }, membership: null })).toBe(404);
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await founded();
    const profile = { ...member, hasAccount: false };
    const locals = { flags: { onboarding: true }, membership: { householdId, member: profile } };
    expect(await opened(locals)).toBe(403);
  });
});
