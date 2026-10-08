import { createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

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

/** A head signed in with two factors, as the guard finds them once their account has a passkey. */
const withTwoFactor = ({ householdId, member }: Awaited<ReturnType<typeof founded>>) => ({
  householdId,
  member: { ...member, twoFactor: true },
});

/** Sends the form that adds an adult, with `name`. */
const addAdult = async (locals: object, name: string) => {
  const body = new FormData();
  body.set('name', name);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.addAdult({ locals, request } as unknown as Parameters<
      typeof actions.addAdult
    >[0]);
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
      mayAddMembers: false,
      you: membership.member.id,
    });
  });

  it('lets a head with two factors add members (ADR-0001 §2, ADR-0010 §3)', async () => {
    const membership = withTwoFactor(await founded());
    expect(await opened({ flags: { onboarding: true }, membership })).toMatchObject({
      mayAddMembers: true,
    });
  });

  it('is not found until onboarding’s flag is on (CODE-20), or outside a household', async () => {
    const membership = await founded();
    expect(await opened({ flags: { onboarding: false }, membership })).toBe(404);
    expect(await opened({ flags: { onboarding: true }, membership: null })).toBe(404);
  });

  it('adds an adult, and says who was added (ADR-0012 §9)', async () => {
    const membership = withTwoFactor(await founded());
    const locals = { flags: { onboarding: true }, membership };
    expect(await addAdult(locals, ' Sam ')).toEqual({ added: 'Sam' });
    expect(await opened(locals)).toMatchObject({
      members: [{ name: 'Robin' }, { name: 'Sam', role: 'adult' }],
    });
  });

  it('keeps a name that isn’t valid in the form, and refuses anyone but a head', async () => {
    const membership = withTwoFactor(await founded());
    const refused = await addAdult({ flags: { onboarding: true }, membership }, 'x'.repeat(101));
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { invalid: true, name: 'x'.repeat(101) },
    });
    const adult = { ...membership, member: { ...membership.member, role: 'adult' } };
    expect(await addAdult({ flags: { onboarding: true }, membership: adult }, 'Sam')).toBe(403);
    expect(await addAdult({ flags: { onboarding: false }, membership }, 'Sam')).toBe(404);
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await founded();
    const profile = { ...member, hasAccount: false };
    const locals = { flags: { onboarding: true }, membership: { householdId, member: profile } };
    expect(await opened(locals)).toBe(403);
  });
});
