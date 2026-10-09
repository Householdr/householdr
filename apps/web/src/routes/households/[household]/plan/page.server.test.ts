import { addTask, createHousehold, draftPlan, membership } from '@householdr/application';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// A household's plan page maps the plans its members may see to the page, or to a status, and the
// form that publishes a draft early to its result (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/**
 * A household in Brussels past setup, whose founding head has two factors and a weekly task, with
 * a draft for the week of Monday 12 October 2026: the test clock reads Thursday 8 October.
 */
const drafted = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const { db, clock } = test.context;
  const result = await createHousehold(
    {
      db,
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
  const { householdId } = result;
  const member = await membership(test.context, accountId, householdId);
  if (!member) throw new Error('Not a member');
  const head = { householdId, member: { ...member, twoFactor: true } };
  await addTask(
    { db, clock, ...head },
    { name: 'Vacuum', duration: 30, frequency: 'weekly', start: '2026-10-14', onMiss: 'roll over' },
  );
  await startTestHousehold(db, householdId, '2026-10-12');
  await draftPlan({ db, clock, householdId, member: 'scheduler' }, { week: '2026-10-12' });
  return head;
};

type Membership = Awaited<ReturnType<typeof drafted>>;
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

/** Sends the form that publishes a draft early, with `fields`. */
const publish = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.publish({ locals, request } as unknown as Parameters<
      typeof actions.publish
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('a household’s plan page (ADR-0006 §2)', () => {
  it('shows a head next week’s draft, with when it is published and why each task went where', async () => {
    const membership = await drafted();
    expect(await opened({ ...on, membership })).toEqual({
      household: 'Ash Lane',
      timeZone: 'Europe/Brussels',
      thisWeek: null,
      nextWeek: {
        start: '2026-10-12',
        last: '2026-10-18',
        status: 'draft',
        version: 1,
        // Sunday 11 October, 12:00 in Brussels.
        publishAt: Date.parse('2026-10-11T10:00:00Z'),
        members: [
          {
            id: membership.member.id,
            name: 'Robin',
            assignments: [
              {
                id: expect.any(String) as unknown,
                task: 'Vacuum',
                date: '2026-10-14',
                cost: 30,
                reason: 'only eligible member',
              },
            ],
          },
        ],
        unassigned: [],
      },
      mayPublish: true,
      you: membership.member.id,
    });
  });

  it('shows other members no draft, then the plan once a head publishes it', async () => {
    const head = await drafted();
    const adult = asAdult(head);
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      nextWeek: null,
      mayPublish: false,
    });
    expect(await publish({ ...on, membership: adult }, { week: '2026-10-12', version: '1' })).toBe(
      403,
    );
    expect(
      await publish({ ...on, membership: head }, { week: '2026-10-12', version: '1' }),
    ).toEqual({ week: '2026-10-12', published: true });
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      nextWeek: { status: 'published', publishAt: null, members: [{ name: 'Robin' }] },
    });
  });

  it('publishes nothing a head hasn’t seen, and says which week (ADR-0019 §5)', async () => {
    const membership = await drafted();
    const refused = await publish({ ...on, membership }, { week: '2026-10-12', version: '2' });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 409,
      data: { week: '2026-10-12', problem: 'conflict' },
    });
    const gone = await publish({ ...on, membership }, { week: '2026-10-19', version: '1' });
    expect(isActionFailure(gone) && gone).toMatchObject({
      status: 409,
      data: { week: '2026-10-19', problem: 'not-found' },
    });
    expect(await publish({ ...on, membership }, { week: 'next week', version: '1' })).toBe(400);
    expect(await opened({ ...on, membership })).toMatchObject({ nextWeek: { status: 'draft' } });
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await drafted();
    const profile = { householdId, member: { ...member, hasAccount: false } };
    expect(await opened({ ...on, membership: profile })).toBe(403);
    expect(
      await publish({ ...on, membership: profile }, { week: '2026-10-12', version: '1' }),
    ).toBe(403);
  });

  it('is not found until the plans’ flag is on (CODE-20), or outside a household', async () => {
    const membership = await drafted();
    const off = { flags: { plans: false } };
    const fields = { week: '2026-10-12', version: '1' };
    expect(await opened({ ...off, membership })).toBe(404);
    expect(await publish({ ...off, membership }, fields)).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
    expect(await publish({ ...on, membership: null }, fields)).toBe(404);
  });
});
