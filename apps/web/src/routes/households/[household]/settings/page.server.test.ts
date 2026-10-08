import { createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The settings page maps the household's settings and their changes to the page, a failure or a
// status (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household and its head with two factors, as the guard leaves them in the request. */
const headOf = async () => {
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
  return {
    flags: { 'household-settings': true },
    membership: { householdId: created.householdId, member: { ...member, twoFactor: true } },
  };
};

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const saved = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.save({ locals, request } as unknown as Parameters<typeof actions.save>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const settings = { name: 'Ash Lane', country: 'BE', timeZone: 'Europe/Brussels', language: 'en' };

describe('the household settings page (ADR-0007 §2)', () => {
  it('shows a head the settings and the languages to choose from', async () => {
    expect(await opened(await headOf())).toEqual({
      settings: { ...settings, version: 1 },
      languages: ['en'],
    });
  });

  it('isn’t there while its flag is off (CODE-20), and is forbidden to anyone but a head', async () => {
    const head = await headOf();
    expect(await opened({ ...head, flags: { 'household-settings': false } })).toBe(404);
    const adult = {
      ...head,
      membership: { ...head.membership, member: { ...head.membership.member, role: 'adult' } },
    };
    expect(await opened(adult)).toBe(403);
    expect(await saved(adult, { ...settings, version: '1' })).toBe(403);
  });

  it('saves a change, and says so', async () => {
    const head = await headOf();
    expect(await saved(head, { ...settings, name: 'Birch Court', version: '1' })).toEqual({
      saved: true,
    });
    expect(await opened(head)).toMatchObject({ settings: { name: 'Birch Court', version: 2 } });
  });

  it('keeps what was entered, and says which fields aren’t valid (UI-10)', async () => {
    const head = await headOf();
    const entered = { ...settings, name: ' ', timeZone: 'Europe/Paris', version: '1' };
    const refused = await saved(head, entered);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { values: { ...entered, version: 1 }, invalid: ['name', 'timeZone'] },
    });
  });

  it('keeps what was entered on a conflict, at the current version, with the settings now (ADR-0019 §5)', async () => {
    const head = await headOf();
    await saved(head, { ...settings, name: 'Birch Court', version: '1' });
    const late = await saved(head, { ...settings, name: 'Cedar Row', version: '1' });
    expect(isActionFailure(late) && late).toMatchObject({
      status: 409,
      data: {
        values: { ...settings, name: 'Cedar Row', version: 2 },
        conflict: { current: { ...settings, name: 'Birch Court', version: 2 }, changedBy: 'Robin' },
      },
    });
  });
});
