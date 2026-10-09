import { addTask, createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// A task's page maps the task and the changes to it to the page, a failure or a status (TEST-4),
// against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const on = { flags: { tasks: true } };
const vacuum = {
  name: 'Vacuum',
  duration: '30',
  frequency: 'weekly',
  start: '2026-10-12',
  onMiss: 'roll over',
};

/**
 * A household in Brussels, its founding head with two factors as the guard leaves them in the
 * request (ADR-0017 §2), and a task of theirs.
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
  const task = await addTask(
    { db: test.context.db, clock: test.context.clock, ...membershipOf },
    { ...vacuum, duration: 30 },
  );
  if (!task.ok) throw new Error(`No task: ${task.error}`);
  return { membership: membershipOf, taskId: task.taskId };
};

const opened = async (locals: object, task: string) => {
  try {
    return await load({ locals, params: { task } } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that saves task `task`, with `fields`. */
const saved = async (locals: object, task: string, fields: Record<string, string>) => {
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

describe('a task’s page (ADR-0001 §2)', () => {
  it('shows a head the task, its version and the days its first time can be', async () => {
    const { membership, taskId } = await founded();
    // The test clock reads 10:00 on 8 October 2026 in Brussels.
    expect(await opened({ ...on, membership }, taskId)).toEqual({
      household: 'Ash Lane',
      task: { ...vacuum, id: taskId, duration: 30, version: 1 },
      starts: { earliest: '2026-10-08', latest: '2027-10-08' },
    });
  });

  it('saves a change, and says so', async () => {
    const { membership, taskId } = await founded();
    const changed = { ...vacuum, name: 'Hoover', frequency: 'monthly', version: '1' };
    expect(await saved({ ...on, membership }, taskId, changed)).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      task: { name: 'Hoover', frequency: 'monthly', version: 2 },
    });
  });

  it('keeps what was typed in the form, and names the fields that won’t do (UI-10)', async () => {
    const { membership, taskId } = await founded();
    const typed = { ...vacuum, name: ' ', duration: '0', start: '2026-10-07' };
    const refused = await saved({ ...on, membership }, taskId, { ...typed, version: '1' });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { values: { ...typed, version: 1 }, invalid: ['name', 'duration', 'start'] },
    });
  });

  it('keeps what was typed on a conflict, at the current version, with the task now (ADR-0019 §5)', async () => {
    const { membership, taskId } = await founded();
    await saved({ ...on, membership }, taskId, { ...vacuum, name: 'Hoover', version: '1' });
    const late = await saved({ ...on, membership }, taskId, {
      ...vacuum,
      duration: '45',
      version: '1',
    });
    expect(isActionFailure(late) && late).toMatchObject({
      status: 409,
      data: {
        values: { ...vacuum, duration: '45', version: 2 },
        conflict: {
          current: { ...vacuum, id: taskId, name: 'Hoover', duration: 30, version: 2 },
        },
      },
    });
  });

  it('is not found for a task the household doesn’t have (TEST-4)', async () => {
    const { membership } = await founded();
    const theirs = await founded();
    for (const task of [theirs.taskId, crypto.randomUUID(), 'vacuum']) {
      expect(await opened({ ...on, membership }, task)).toBe(404);
      expect(await saved({ ...on, membership }, task, { ...vacuum, version: '1' })).toBe(404);
    }
  });

  it('is forbidden to anyone but a head with two factors (ADR-0001 §2)', async () => {
    const { membership, taskId } = await founded();
    const adult = { ...membership, member: { ...membership.member, role: 'adult' } };
    expect(await opened({ ...on, membership: adult }, taskId)).toBe(403);
    expect(await saved({ ...on, membership: adult }, taskId, { ...vacuum, version: '1' })).toBe(
      403,
    );
  });

  it('is not found until the tasks’ flag is on (CODE-20), or outside a household', async () => {
    const { membership, taskId } = await founded();
    const off = { flags: { tasks: false } };
    expect(await opened({ ...off, membership }, taskId)).toBe(404);
    expect(await saved({ ...off, membership }, taskId, { ...vacuum, version: '1' })).toBe(404);
    expect(await opened({ ...on, membership: null }, taskId)).toBe(404);
  });
});
