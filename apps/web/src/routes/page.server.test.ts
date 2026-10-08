import { createHousehold } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// Where a signed-in account starts (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

let next = 0;
const newAccount = () =>
  createTestAccount(test.context.auth, {
    email: `robin-${String(++next)}@example.org`,
    password: 'correct horse battery staple',
  });

/** A household named `name`, founded by `accountId`. */
const household = async (accountId: string, name: string) => {
  const result = await createHousehold(
    {
      db: test.context.db,
      actor: { account: accountId, twoFactor: true },
      account: { id: accountId, managed: false, guardians: [] },
    },
    {
      name,
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!result.ok) throw new Error(`No household: ${result.error}`);
  return result.householdId;
};

const opened = async (accountId: string, onboarding = true) => {
  try {
    return await load({
      locals: { flags: { onboarding }, session: { id: 'session', accountId } },
    } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isRedirect(thrown)) return `→ ${thrown.location}`;
    throw thrown;
  }
};

describe('the start page (ADR-0005 §1)', () => {
  it('goes to the account’s household when it has one', async () => {
    const robin = await newAccount();
    const id = await household(robin, 'Ash Lane');
    expect(await opened(robin)).toBe(`→ /households/${id}`);
  });

  it('lists the households when there are several, and none when there are none', async () => {
    const robin = await newAccount();
    const birch = await household(robin, 'Birch Court');
    const ash = await household(robin, 'Ash Lane');
    expect(await opened(robin)).toEqual({
      households: [
        { id: ash, name: 'Ash Lane', role: 'head' },
        { id: birch, name: 'Birch Court', role: 'head' },
      ],
    });
    expect(await opened(await newAccount())).toEqual({ households: [] });
  });

  it('is the security page until onboarding’s flag is on (CODE-20)', async () => {
    const robin = await newAccount();
    await household(robin, 'Ash Lane');
    expect(await opened(robin, false)).toBe('→ /security');
  });
});
