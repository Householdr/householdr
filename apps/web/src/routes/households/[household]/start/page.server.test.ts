import { createHousehold, membership, viewPlan } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The Start page maps the ways to start a household to the page, and the form that starts it to a
// redirect or a refusal (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/**
 * A household in Brussels in setup, and its founding head with two factors, as the guard leaves
 * them in the request (ADR-0017 §2). The test clock reads Thursday 8 October 2026, 10:00.
 */
const inSetup = async () => {
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
  return { householdId: result.householdId, member: { ...member, twoFactor: true } };
};

type Membership = Awaited<ReturnType<typeof inSetup>>;
const on = { flags: { plans: true } };
const asAdult = ({ householdId, member }: Membership) => ({
  householdId,
  member: { ...member, role: 'adult' as const },
});

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the Start form, choosing `when` if given; a redirect comes back as where it goes. */
const start = async (locals: object, when?: string) => {
  const body = new FormData();
  if (when !== undefined) body.set('when', when);
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

describe('the Start page (ADR-0007 §2 step 7, §3)', () => {
  it('shows a head in setup this week’s days left, and when next week’s plan comes', async () => {
    const membership = await inSetup();
    expect(await opened({ ...on, membership })).toEqual({
      options: {
        timeZone: 'Europe/Brussels',
        now: { today: '2026-10-08', last: '2026-10-11' },
        weekStart: {
          week: '2026-10-12',
          // Saturday 10 October 00:00 and Sunday 11 October 12:00 in Brussels.
          draftAt: Date.parse('2026-10-09T22:00:00Z'),
          publishAt: Date.parse('2026-10-11T10:00:00Z'),
        },
      },
    });
  });

  it('starts now, then goes to this week’s draft for the head to publish', async () => {
    const membership = await inSetup();
    expect(await start({ ...on, membership }, 'now')).toEqual({
      status: 303,
      location: `/households/${membership.householdId}/plan`,
    });
    const { db, clock } = test.context;
    const plan = await viewPlan({ db, clock, ...membership });
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.thisWeek?.start.toString()).toBe('2026-10-05');
    expect(plan.thisWeek).toMatchObject({ status: 'draft', publishAt: null });
    // Once started, the page offers nothing more.
    expect(await opened({ ...on, membership })).toEqual({ options: null });
  });

  it('starts on the week start day, then goes to the household’s page to say when', async () => {
    const membership = await inSetup();
    expect(await start({ ...on, membership }, 'week start')).toEqual({
      status: 303,
      location: `/households/${membership.householdId}?started`,
    });
  });

  it('keeps the choice when it is refused, and refuses a second start', async () => {
    const membership = await inSetup();
    const invalid = await start({ ...on, membership }, 'later');
    expect(isActionFailure(invalid) && invalid).toMatchObject({
      status: 400,
      data: { problem: 'invalid', when: 'later' },
    });
    const missing = await start({ ...on, membership });
    expect(isActionFailure(missing) && missing).toMatchObject({
      status: 400,
      data: { problem: 'invalid', when: null },
    });
    await start({ ...on, membership }, 'week start');
    const again = await start({ ...on, membership }, 'now');
    expect(isActionFailure(again) && again).toMatchObject({
      status: 409,
      data: { problem: 'already-started', when: 'now' },
    });
  });

  it('is forbidden to anyone but a head with two factors (TEST-4)', async () => {
    const head = await inSetup();
    const adult = asAdult(head);
    const noSecondFactor = { ...head, member: { ...head.member, twoFactor: false } };
    for (const membership of [adult, noSecondFactor]) {
      expect(await opened({ ...on, membership })).toBe(403);
      expect(await start({ ...on, membership }, 'now')).toBe(403);
    }
    // Still in setup: the head can start it.
    expect(await opened({ ...on, membership: head })).toMatchObject({ options: { now: {} } });
  });

  it('is not found until the plans’ flag is on (CODE-20), or outside a household', async () => {
    const membership = await inSetup();
    const off = { flags: { plans: false } };
    expect(await opened({ ...off, membership })).toBe(404);
    expect(await start({ ...off, membership }, 'now')).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
    expect(await start({ ...on, membership: null }, 'now')).toBe(404);
    expect(await opened({ ...on, membership })).toMatchObject({ options: { now: {} } });
  });
});
