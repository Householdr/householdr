import { createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// A household's areas page maps what its members see to the page, or to a status, and its forms to
// their results (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household in Brussels and its founding head, with two factors, as the guard leaves them. */
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

const on = { flags: { tasks: true } };

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form of `action` with `fields`. */
const sent = async (
  action: keyof typeof actions,
  locals: object,
  fields: Record<string, string>,
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  type Event = Parameters<(typeof actions)[typeof action]>[0];
  try {
    return await actions[action]({ locals, request } as unknown as Event);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('a household’s areas page (ADR-0001 §1, clarification)', () => {
  it('adds, renames and removes areas, and shows them', async () => {
    const membership = await founded();
    const locals = { ...on, membership };
    expect(await opened(locals)).toEqual({ household: 'Ash Lane', areas: [], mayChange: true });
    expect(await sent('add', locals, { name: 'Kitchen' })).toEqual({ added: 'Kitchen' });
    const page = await opened(locals);
    if (typeof page === 'number') throw new Error(`No page: ${String(page)}`);
    const [kitchen] = page.areas;
    if (!kitchen) throw new Error('No area');
    expect(await sent('rename', locals, { areaId: kitchen.id, name: 'Galley' })).toEqual({
      renamed: 'Galley',
    });
    expect(await sent('remove', locals, { areaId: kitchen.id })).toEqual({ removed: 'Galley' });
    expect(await sent('remove', locals, { areaId: kitchen.id })).toBe(404);
  });

  it('keeps what was typed, and says why it won’t do (UI-10)', async () => {
    const membership = await founded();
    const locals = { ...on, membership };
    await sent('add', locals, { name: 'Kitchen' });
    const taken = await sent('add', locals, { name: 'kitchen' });
    expect(isActionFailure(taken) && taken.data).toEqual({
      problem: 'taken',
      areaId: undefined,
      name: 'kitchen',
    });
    const empty = await sent('add', locals, { name: ' ' });
    expect(isActionFailure(empty) && empty.data).toMatchObject({ problem: 'invalid' });
  });

  it('shows other members the areas but changes none of theirs, and is there only with its flag', async () => {
    const founding = await founded();
    const adult = { ...founding, member: { ...founding.member, role: 'adult' } };
    expect(await opened({ ...on, membership: adult })).toMatchObject({ mayChange: false });
    expect(await sent('add', { ...on, membership: adult }, { name: 'Garden' })).toBe(403);
    expect(await opened({ flags: { tasks: false }, membership: founding })).toBe(404);
  });
});
