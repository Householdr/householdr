import { createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// A household's tasks page maps what its members see to the page, or to a status, and the form
// that adds a task to its result (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/**
 * A household in Brussels and its founding head, as the guard leaves them in the request (ADR-0017
 * §2): with two factors, as after signing in with a passkey.
 */
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
  return { householdId: result.householdId, member: { ...member, twoFactor: true } };
};

type Membership = Awaited<ReturnType<typeof founded>>;
const on = { flags: { tasks: true } };

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that adds a task, with `fields`. */
const add = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.add({ locals, request } as unknown as Parameters<typeof actions.add>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const vacuum = { name: 'Vacuum', duration: '30', frequency: 'weekly', start: '2026-10-08' };
const asAdult = ({ householdId, member }: Membership) => ({
  householdId,
  member: { ...member, role: 'adult' },
});

describe('a household’s tasks page (ADR-0001 §1)', () => {
  it('shows a head the tasks, and the days a new one can start on', async () => {
    const membership = await founded();
    // The test clock reads 10:00 on 8 October 2026 in Brussels.
    expect(await opened({ ...on, membership })).toEqual({
      household: 'Ash Lane',
      tasks: [],
      mayAddTasks: true,
      starts: { earliest: '2026-10-08', latest: '2027-10-08' },
    });
  });

  it('adds a task, says so, and lists it (ADR-0004 §3)', async () => {
    const membership = await founded();
    expect(await add({ ...on, membership }, { ...vacuum, name: ' Vacuum ' })).toEqual({
      added: 'Vacuum',
    });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [{ name: 'Vacuum', duration: 30, frequency: 'weekly' }],
    });
  });

  it('starts a task today when no day is sent', async () => {
    const membership = await founded();
    expect(await add({ ...on, membership }, { ...vacuum, start: '' })).toEqual({
      added: 'Vacuum',
    });
  });

  it('keeps what was typed in the form, and names the fields that won’t do (UI-10)', async () => {
    const membership = await founded();
    const typed = { name: '   ', duration: '0', frequency: 'hourly', start: '2026-10-07' };
    const refused = await add({ ...on, membership }, typed);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { invalid: ['name', 'duration', 'frequency', 'start'], values: typed },
    });
    expect(await opened({ ...on, membership })).toMatchObject({ tasks: [] });
  });

  it('shows other members the tasks, but adds none of theirs (ADR-0001 §2)', async () => {
    const head = await founded();
    await add({ ...on, membership: head }, vacuum);
    const adult = asAdult(head);
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      tasks: [{ name: 'Vacuum' }],
      mayAddTasks: false,
    });
    expect(await add({ ...on, membership: adult }, vacuum)).toBe(403);
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await founded();
    const profile = { householdId, member: { ...member, hasAccount: false } };
    expect(await opened({ ...on, membership: profile })).toBe(403);
    expect(await add({ ...on, membership: profile }, vacuum)).toBe(403);
  });

  it('is not found until the tasks’ flag is on (CODE-20), or outside a household', async () => {
    const membership = await founded();
    const off = { flags: { tasks: false } };
    expect(await opened({ ...off, membership })).toBe(404);
    expect(await add({ ...off, membership }, vacuum)).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
    expect(await add({ ...on, membership: null }, vacuum)).toBe(404);
  });
});
