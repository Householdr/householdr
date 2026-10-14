import { addOneOff, createHousehold, editOneOff, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The page that confirms removing a one-off task maps it and its removal to the page, a redirect,
// a failure or a status (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const shelf = { name: 'Fix the shelf', duration: 30, date: '2026-10-14', onMiss: 'roll over' };

/**
 * A household in Brussels, its founding head with two factors as the guard leaves them in the
 * request (ADR-0017 §2), and a one-off task Robin added.
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
  const membershipOf = { householdId: result.householdId, member: { ...member, twoFactor: true } };
  const context = { db: test.context.db, clock: test.context.clock, ...membershipOf };
  const task = await addOneOff(context, shelf);
  if (!task.ok) throw new Error(`No task: ${task.error}`);
  return { context, membership: membershipOf, taskId: task.taskId };
};

const on = { flags: { tasks: true } };

const opened = async (locals: object, task: string) => {
  try {
    return await load({ locals, params: { task } } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Another adult of the household of `of`, as the guard leaves them in the request. */
const someoneElse = (of: { householdId: string; member: object }) => ({
  ...of,
  member: { ...of.member, id: crypto.randomUUID(), role: 'adult' },
});

/** Confirms removing one-off `task` of the household of `locals`, from `version`. */
const removed = async (
  locals: { membership: { householdId: string } | null },
  task: string,
  version: string,
) => {
  const body = new FormData();
  body.set('version', version);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  const params = { household: locals.membership?.householdId, task };
  try {
    return await actions.default({ locals, params, request } as unknown as Parameters<
      typeof actions.default
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location };
    throw thrown;
  }
};

describe('removing a one-off task (ADR-0006 §3, clarification)', () => {
  it('asks the member who added it about the one-off as it is now', async () => {
    const { membership, taskId } = await founded();
    expect(await opened({ ...on, membership }, taskId)).toEqual({
      household: 'Ash Lane',
      oneOff: { ...shelf, id: taskId, deadline: undefined, version: 1 },
    });
  });

  it('removes it, and leads back to the tasks, which say so', async () => {
    const { membership, taskId } = await founded();
    expect(await removed({ ...on, membership }, taskId, '1')).toEqual({
      status: 303,
      location: `/households/${membership.householdId}/tasks?task=removed`,
    });
    expect(await opened({ ...on, membership }, taskId)).toBe(404);
  });

  it('removes nothing changed since, and gives the one-off now (ADR-0019 §5)', async () => {
    const { context, membership, taskId } = await founded();
    await editOneOff(context, { ...shelf, taskId, version: 1, name: 'Fix the shelves' });
    const late = await removed({ ...on, membership }, taskId, '1');
    expect(isActionFailure(late) && late).toMatchObject({
      status: 409,
      data: { conflict: { current: { name: 'Fix the shelves', version: 2 } } },
    });
    expect(await removed({ ...on, membership }, taskId, '')).toBe(400);
  });

  it('is forbidden to another adult, and not found for no one-off of the household (TEST-4)', async () => {
    const { membership, taskId } = await founded();
    expect(await opened({ ...on, membership: someoneElse(membership) }, taskId)).toBe(403);
    expect(await removed({ ...on, membership: someoneElse(membership) }, taskId, '1')).toBe(403);
    const theirs = await founded();
    for (const task of [theirs.taskId, crypto.randomUUID(), 'shelf']) {
      expect(await opened({ ...on, membership }, task)).toBe(404);
      expect(await removed({ ...on, membership }, task, '1')).toBe(404);
    }
  });

  it('is not found until the tasks’ flag is on (CODE-20), or outside a household', async () => {
    const { membership, taskId } = await founded();
    const off = { flags: { tasks: false } };
    expect(await opened({ ...off, membership }, taskId)).toBe(404);
    expect(await removed({ ...off, membership }, taskId, '1')).toBe(404);
    expect(await opened({ ...on, membership: null }, taskId)).toBe(404);
  });
});
