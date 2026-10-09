import {
  addTask,
  createHousehold,
  draftPlan,
  membership,
  publishPlan,
  settlePlanWeek,
} from '@householdr/application';
import { settableClock } from '@householdr/application/testing';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// The balances page maps every member's balance and its history to the page, or to a status
// (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/**
 * Ash Lane in Brussels, founded by Robin, a head with two factors, with vacuuming on Wednesdays:
 * the week of Monday 12 October 2026 is published, and once it is over, settled with nobody having
 * vacuumed.
 */
const settled = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const { db } = test.context;
  const created = await createHousehold(
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
  if (!created.ok) throw new Error(`No household: ${created.error}`);
  const { householdId } = created;
  const member = await membership(test.context, accountId, householdId);
  if (!member) throw new Error('Not a member');
  const head = { householdId, member: { ...member, twoFactor: true } };
  // Thursday 8 October 2026.
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  await addTask(
    { db, clock, ...head },
    { name: 'Vacuum', duration: 30, frequency: 'weekly', start: '2026-10-14', onMiss: 'roll over' },
  );
  await startTestHousehold(db, householdId, '2026-10-12');
  const scheduler = { db, clock, householdId, member: 'scheduler' as const };
  await draftPlan(scheduler, { week: '2026-10-12' });
  await publishPlan(scheduler, { week: '2026-10-12' });
  // Monday 19 October in Brussels: the week is over.
  clock.advance({ hours: 11 * 24 });
  await settlePlanWeek(scheduler, { week: '2026-10-12' });
  return head;
};

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('the balances page (ADR-0002 §6)', () => {
  it('shows every member’s balance and what each settled week changed it by, for any member', async () => {
    const head = await settled();
    const expected = {
      rebalance: 'normal',
      members: [
        {
          id: head.member.id,
          name: 'Robin',
          balance: -30,
          history: [{ start: '2026-10-12', last: '2026-10-18', change: -30 }],
        },
      ],
      you: head.member.id,
    };
    expect(await opened({ flags: { balances: true }, membership: head })).toEqual(expected);
    const adult = { ...head, member: { ...head.member, role: 'adult' as const } };
    expect(await opened({ flags: { balances: true }, membership: adult })).toEqual(expected);
  });

  it('is not found until its flag is on (CODE-20), or outside a household', async () => {
    const head = await settled();
    expect(await opened({ flags: { balances: false }, membership: head })).toBe(404);
    expect(await opened({ flags: { balances: true }, membership: null })).toBe(404);
  });

  it('is forbidden to a profile without an account (ADR-0018 §4)', async () => {
    const head = await settled();
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await opened({ flags: { balances: true }, membership: profile })).toBe(403);
  });
});
