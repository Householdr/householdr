import { createHousehold, draftPlan, membership, startHousehold } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// The notifications page maps the member's own notifications to the page (TEST-4), against a real
// database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Ash Lane, whose head is Robin, started from the week of 12 October. */
const household = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
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
  const member = await membership(test.context, accountId, created.householdId);
  if (!member) throw new Error('Not a member');
  const head = { householdId: created.householdId, member: { ...member, twoFactor: true } };
  await startHousehold({ ...test.context, ...head }, { when: 'week start' });
  return head;
};

describe('the notifications page (ADR-0014 §7, clarification)', () => {
  it('shows the member’s own notifications, with the day they came and the plan’s week', async () => {
    const head = await household();
    expect(await opened({ flags: { notifications: true }, membership: head })).toEqual({
      household: 'Ash Lane',
      notifications: [],
    });
    // The scheduler drafts the first week, which Robin hears of (ADR-0014 §2).
    const scheduler = {
      ...test.context,
      householdId: head.householdId,
      member: 'scheduler' as const,
    };
    expect(await draftPlan(scheduler, { week: '2026-10-12' })).toMatchObject({ ok: true });
    expect(await opened({ flags: { notifications: true }, membership: head })).toEqual({
      household: 'Ash Lane',
      notifications: [
        {
          id: expect.any(String) as string,
          kind: 'plan.drafted',
          day: '2026-10-08',
          when: 'today',
          first: '2026-10-12',
          last: '2026-10-18',
        },
      ],
    });
  });

  it('isn’t there while its flag is off, nor outside a household (CODE-20, ADR-0017 §2)', async () => {
    const head = await household();
    expect(await opened({ flags: { notifications: false }, membership: head })).toBe(404);
    expect(await opened({ flags: { notifications: true }, membership: null })).toBe(404);
  });

  it('is refused to a profile without an account (ADR-0017 §2)', async () => {
    const head = await household();
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await opened({ flags: { notifications: true }, membership: profile })).toBe(403);
  });
});
