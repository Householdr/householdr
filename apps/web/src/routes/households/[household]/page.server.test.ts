import {
  acceptInvitation,
  addAdult as addProfile,
  createHousehold,
  invite,
  leaveHousehold,
  membership,
  startHousehold,
} from '@householdr/application';
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

const opened = async (locals: object, address = 'https://householdr.example.org/households/x') => {
  try {
    const url = new URL(address);
    return await load({ locals, url } as unknown as Parameters<typeof load>[0]);
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
          removable: false,
        },
      ],
      mayAddMembers: false,
      mayLeave: true,
      mayChangeSettings: false,
      mayStart: false,
      namedHead: null,
      // Robin signs in with a password alone in this test (ADR-0010 §3).
      needsTwoFactors: true,
      started: null,
      removed: false,
      you: membership.member.id,
    });
  });

  it('offers leaving to anyone but a child (ADR-0010 §10)', async () => {
    const { householdId, member } = await founded();
    const child = { householdId, member: { ...member, role: 'child' as const } };
    expect(await opened({ flags: { onboarding: true }, membership: child })).toMatchObject({
      mayLeave: false,
    });
  });

  it('lets a head with two factors add members (ADR-0001 §2, ADR-0010 §3)', async () => {
    const membership = withTwoFactor(await founded());
    expect(await opened({ flags: { onboarding: true }, membership })).toMatchObject({
      mayAddMembers: true,
    });
  });

  it('lets a head start it while in setup, then says when the first plan comes (ADR-0007 §3)', async () => {
    const membership = withTwoFactor(await founded());
    const locals = { flags: { onboarding: true }, membership };
    expect(await opened(locals)).toMatchObject({ mayStart: true, started: null });
    const { db, clock } = test.context;
    await startHousehold({ db, clock, ...membership }, { when: 'week start' });
    // The test clock reads Thursday 8 October 2026: the first plan is for the week of 12 October,
    // drafted on Saturday 10 October at 00:00 and published on Sunday 11 October at 12:00.
    expect(
      await opened(locals, 'https://householdr.example.org/households/x?started'),
    ).toMatchObject({
      mayStart: false,
      started: {
        week: '2026-10-12',
        draftAt: Date.parse('2026-10-09T22:00:00Z'),
        publishAt: Date.parse('2026-10-11T10:00:00Z'),
        timeZone: 'Europe/Brussels',
      },
    });
    // Only right after starting.
    expect(await opened(locals)).toMatchObject({ mayStart: false, started: null });
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

/** Sends the form that answers the last head's naming with `answer`. */
const answerHeadRole = async (locals: object, answer: string) => {
  const body = new FormData();
  body.set('answer', answer);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.answerHeadRole({ locals, request } as unknown as Parameters<
      typeof actions.answerHeadRole
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('a member the last head named head (ADR-0018 §2, clarification)', () => {
  /** Robin, the last head, leaves Ash Lane naming Alex, who accepted an invitation, head. */
  const named = async () => {
    const head = withTwoFactor(await founded());
    const context = { ...test.context, ...head };
    const profile = await addProfile(context, { name: 'Alex' });
    if (!profile.ok) throw new Error('No profile');
    const link = await invite(context, { member: profile.memberId });
    if (!link.ok) throw new Error('No link');
    const alex = await createTestAccount(test.context.auth, {
      email: `alex-${crypto.randomUUID()}@example.org`,
      password: 'correct horse battery staple',
    });
    await acceptInvitation(test.context, alex, link.token);
    await leaveHousehold(context, { shownAs: 'name', successor: profile.memberId });
    const member = await membership(test.context, alex, head.householdId);
    if (!member) throw new Error('Not a member');
    return { householdId: head.householdId, member };
  };
  const flags = { onboarding: true, leaving: true };

  it('asks them whether they take it on, and to set up two factors', async () => {
    const membership = await named();
    expect(await opened({ flags, membership })).toMatchObject({
      namedHead: { mayDecline: false },
      needsTwoFactors: true,
    });
  });

  it('takes it on, and says so', async () => {
    const membership = await named();
    // The only adult with an account can't decline it.
    const refused = await answerHeadRole({ flags, membership }, 'decline');
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 409,
      data: { headProblem: 'only-adult' },
    });
    expect(await answerHeadRole({ flags, membership }, 'take on')).toEqual({
      answered: 'took on',
    });
    expect(await opened({ flags, membership })).toMatchObject({ namedHead: null });
    // Asked once only.
    expect(await answerHeadRole({ flags, membership }, 'take on')).toBe(403);
  });

  it('refuses what isn’t an answer, and isn’t there while leaving’s flag is off (CODE-20)', async () => {
    const membership = await named();
    const refused = await answerHeadRole({ flags, membership }, 'maybe');
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { headProblem: 'invalid' },
    });
    const off = { ...flags, leaving: false };
    expect(await answerHeadRole({ flags: off, membership }, 'take on')).toBe(404);
  });
});
