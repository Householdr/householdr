import {
  changeHouseholdSettings,
  createHousehold,
  membership,
  startHousehold,
} from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// The activity page maps the household's log to the page (TEST-4), against a real database
// (TEST-11).

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

describe('the activity page (ADR-0018 §5)', () => {
  it('shows the entries newest first, with when, in the household’s time zone', async () => {
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
    await changeHouseholdSettings(
      { ...test.context, ...head },
      {
        name: 'Birch Court',
        country: 'BE',
        timeZone: 'Europe/Brussels',
        language: 'en',
        version: 1,
      },
    );
    expect(await opened({ flags: { 'activity-log': true }, membership: head })).toEqual({
      timeZone: 'Europe/Brussels',
      entries: [
        {
          id: expect.any(String) as string,
          at: test.context.clock.now().epochMilliseconds,
          actor: 'Robin',
          action: 'household.name',
          setBeforeStart: null,
        },
      ],
    });
    // Starting it lists what was set for others before, by name: nothing here (ADR-0007 §2).
    test.context.clock.advance({ hours: 1 });
    await startHousehold({ ...test.context, ...head }, { when: 'week start' });
    expect(await opened({ flags: { 'activity-log': true }, membership: head })).toMatchObject({
      entries: [
        {
          actor: 'Robin',
          action: 'household.started',
          setBeforeStart: { shares: [], daysAway: [] },
        },
        { action: 'household.name', setBeforeStart: null },
      ],
    });
    expect(await opened({ flags: { 'activity-log': false }, membership: head })).toBe(404);
    expect(await opened({ flags: { 'activity-log': true }, membership: null })).toBe(404);
  });
});
