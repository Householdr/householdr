import { addAdult as addProfile, createHousehold, membership } from '@householdr/application';
import { keptConsents } from '@householdr/application/testing';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { m } from '#lib/paraglide/messages.js';
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

/** Sends the form of action `name` about member `member`. */
const aboutMember = async (name: 'invite' | 'revokeInvitation', locals: object, member: string) => {
  const body = new FormData();
  body.set('member', member);
  const url = new URL('https://householdr.example.org/households/x');
  const request = new Request(url, { method: 'POST', body });
  try {
    return await actions[name]({ locals, request, url } as unknown as Parameters<
      (typeof actions)['invite']
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that adds a child, with `fields`; the consent box ticked if it is `on`. */
const addChild = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.addChild({ locals, request } as unknown as Parameters<
      typeof actions.addChild
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const kim = { name: 'Kim', birthDate: '2016-03-01', consent: 'on' };

describe('a household’s page (ADR-0007 §1)', () => {
  it('shows the household’s name and members, and which one is you', async () => {
    const membership = await founded();
    expect(await opened({ flags: { onboarding: true }, membership })).toEqual({
      name: 'Ash Lane',
      members: [
        {
          id: membership.member.id,
          name: 'Robin',
          role: 'head',
          account: null,
          invitable: false,
          invitationDaysLeft: null,
        },
      ],
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

  it('adds a child, keeping the consent in the words the page showed (ADR-0010 §9)', async () => {
    const membership = withTwoFactor(await founded());
    const locals = { flags: { onboarding: true }, membership };
    expect(await addChild(locals, { ...kim, name: ' Kim ' })).toEqual({ addedChild: 'Kim' });
    expect(await opened(locals)).toMatchObject({
      members: [{ name: 'Robin' }, { name: 'Kim', role: 'child' }],
    });
    // In the language the page is in, at the time the test's clock tells.
    expect(await keptConsents(test.context.db, membership.householdId)).toEqual([
      {
        givenAt: new Date('2026-10-08T08:00:00Z'),
        text: m['household.child-consent'](),
        language: 'en',
      },
    ]);
    expect(m['household.child-consent']()).toBe(
      'I have parental responsibility for this child, and I agree to them using Householdr.',
    );
  });

  it('keeps what was entered for a child, and says what needs changing', async () => {
    const membership = withTwoFactor(await founded());
    const locals = { flags: { onboarding: true }, membership };
    // 18 today in Brussels, by the test's clock; the box left empty.
    const refused = await addChild(locals, { name: ' ', birthDate: '2008-10-08' });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: {
        child: {
          problems: ['name', 'adult', 'consent'],
          name: ' ',
          birthDate: '2008-10-08',
          consent: false,
        },
      },
    });
    // Only a checkbox's own value counts as ticking it.
    const other = await addChild(locals, { ...kim, consent: 'true' });
    expect(isActionFailure(other) && other.data).toMatchObject({
      child: { problems: ['consent'] },
    });
    expect(await keptConsents(test.context.db, membership.householdId)).toEqual([]);
  });

  it('lets only a head with two factors add a child', async () => {
    const membership = await founded();
    expect(await addChild({ flags: { onboarding: true }, membership }, kim)).toBe(403);
    const head = withTwoFactor(membership);
    const adult = { ...head, member: { ...head.member, role: 'adult' } };
    expect(await addChild({ flags: { onboarding: true }, membership: adult }, kim)).toBe(403);
    expect(await addChild({ flags: { onboarding: false }, membership: head }, kim)).toBe(404);
    expect(await keptConsents(test.context.db, head.householdId)).toEqual([]);
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await founded();
    const profile = { ...member, hasAccount: false };
    const locals = { flags: { onboarding: true }, membership: { householdId, member: profile } };
    expect(await opened(locals)).toBe(403);
  });
});

describe('invitation links on a household’s page (ADR-0010 §5)', () => {
  /** A head with two factors and Kim's profile. */
  const withKim = async () => {
    const membership = withTwoFactor(await founded());
    const kim = await addProfile({ ...test.context, ...membership }, { name: 'Kim' });
    if (!kim.ok) throw new Error('No profile');
    return { locals: { flags: { onboarding: true }, membership }, kim: kim.memberId };
  };

  it('makes a link to show once, then says for how many days it works', async () => {
    const { locals, kim } = await withKim();
    const made = await aboutMember('invite', locals, kim);
    expect(made).toEqual({
      invited: kim,
      link: expect.stringMatching(
        /^https:\/\/householdr\.example\.org\/invitations\/[\w-]{43}$/,
      ) as string,
      // The same link as a QR code, for a phone in the same room.
      qr: { size: expect.any(Number) as number, path: expect.stringMatching(/^M\d/) as string },
    });
    expect(await opened(locals)).toMatchObject({
      members: [{}, { id: kim, invitable: true, invitationDaysLeft: 7 }],
    });
  });

  it('revokes a link, and refuses both to anyone but a head', async () => {
    const { locals, kim } = await withKim();
    await aboutMember('invite', locals, kim);
    expect(await aboutMember('revokeInvitation', locals, kim)).toEqual({ revoked: kim });
    expect(await opened(locals)).toMatchObject({ members: [{}, { invitationDaysLeft: null }] });
    const adult = {
      ...locals,
      membership: { ...locals.membership, member: { ...locals.membership.member, role: 'adult' } },
    };
    expect(await aboutMember('invite', adult, kim)).toBe(403);
    expect(await aboutMember('revokeInvitation', adult, kim)).toBe(403);
  });

  it('says when a profile can’t be invited', async () => {
    const { locals } = await withKim();
    const refused = await aboutMember('invite', locals, locals.membership.member.id);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 404,
      data: { notInvitable: true },
    });
  });
});
