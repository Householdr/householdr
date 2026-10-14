import { addOneOff, createHousehold, editOneOff, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The page that changes a one-off task maps it and saving it to the page, a failure or a status
// (TEST-4), against a real database (TEST-11).

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

/** Saves one-off `task` of the household of `locals` with `fields`. */
const saved = async (
  locals: { membership: { householdId: string } | null },
  task: string,
  fields: Record<string, string>,
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.save({ locals, params: { task }, request } as unknown as Parameters<
      typeof actions.save
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const form = { ...shelf, duration: '30', deadline: '', version: '1' };

describe('changing a one-off task (ADR-0006 §3, clarification)', () => {
  it('shows the member who added it the one-off as it is now, and the days it can move to', async () => {
    const { membership, taskId } = await founded();
    // The test clock reads 10:00 on 8 October 2026 in Brussels.
    expect(await opened({ ...on, membership }, taskId)).toEqual({
      household: 'Ash Lane',
      oneOff: { ...shelf, id: taskId, deadline: '', version: 1 },
      dates: { earliest: '2026-10-08', latest: '2027-10-08' },
    });
  });

  it('saves it, with a deadline or without', async () => {
    const { membership, taskId } = await founded();
    const changed = { ...form, name: 'Fix the shelves', deadline: '2026-10-30' };
    expect(await saved({ ...on, membership }, taskId, changed)).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      oneOff: { name: 'Fix the shelves', deadline: '2026-10-30', version: 2 },
    });
    expect(
      await saved({ ...on, membership }, taskId, { ...changed, version: '2', deadline: '' }),
    ).toEqual({
      saved: true,
    });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      oneOff: { deadline: '', version: 3 },
    });
  });

  it('keeps what was typed, and names the fields that won’t do (UI-10)', async () => {
    const { membership, taskId } = await founded();
    const typed = { ...form, duration: '0', deadline: '2026-10-13' };
    const refused = await saved({ ...on, membership }, taskId, typed);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { invalid: ['duration', 'deadline'], values: { ...typed, version: 1 } },
    });
  });

  it('saves nothing changed since, and gives the one-off now (ADR-0019 §5)', async () => {
    const { context, membership, taskId } = await founded();
    await editOneOff(context, { ...shelf, taskId, version: 1, name: 'Fix the shelves' });
    const late = await saved({ ...on, membership }, taskId, { ...form, duration: '45' });
    expect(isActionFailure(late) && late).toMatchObject({
      status: 409,
      data: {
        values: { duration: '45', version: 2 },
        conflict: { current: { name: 'Fix the shelves', deadline: '', version: 2 } },
      },
    });
  });

  it('is forbidden to another adult, and not found for no one-off of the household (TEST-4)', async () => {
    const { membership, taskId } = await founded();
    expect(await opened({ ...on, membership: someoneElse(membership) }, taskId)).toBe(403);
    expect(await saved({ ...on, membership: someoneElse(membership) }, taskId, form)).toBe(403);
    const theirs = await founded();
    for (const task of [theirs.taskId, crypto.randomUUID(), 'shelf']) {
      expect(await opened({ ...on, membership }, task)).toBe(404);
      expect(await saved({ ...on, membership }, task, form)).toBe(404);
    }
  });

  it('is not found until the tasks’ flag is on (CODE-20), or outside a household', async () => {
    const { membership, taskId } = await founded();
    const off = { flags: { tasks: false } };
    expect(await opened({ ...off, membership }, taskId)).toBe(404);
    expect(await saved({ ...off, membership }, taskId, form)).toBe(404);
    expect(await opened({ ...on, membership: null }, taskId)).toBe(404);
  });
});
