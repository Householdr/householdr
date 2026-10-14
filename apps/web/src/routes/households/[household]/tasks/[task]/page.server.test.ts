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

/** Sends the form that saves task `task`, with `fields`, those with several values once for each. */
const saved = async (locals: object, task: string, fields: Record<string, string | string[]>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of [value].flat()) body.append(name, each);
  }
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
      task: {
        ...vacuum,
        id: taskId,
        duration: 30,
        everyCount: '',
        everyUnit: 'weeks',
        // Any time that week; set times would start on the day itself, 08:00 to 20:00.
        when: 'week',
        fromDay: '0',
        fromTime: '08:00',
        toDay: '0',
        toTime: '20:00',
        version: 1,
        sharedWith: [],
        constraints: [],
        // One rule from today, should it turn to an advanced schedule (ADR-0004 §3).
        rules: [{ kind: 'weeks', every: '1', days: [], which: [], day: '1', start: '2026-10-08' }],
        extraDates: [],
        exceptionDates: [],
      },
      starts: { earliest: '2026-10-08', latest: '2027-10-08' },
      dates: { earliest: '2026-10-08', latest: '2028-10-08' },
      today: '2026-10-08',
      shareable: [],
      members: [{ id: membership.member.id, name: 'Robin', child: false }],
      linkable: [],
      areas: [],
      who: { minimumAge: '', linkedTo: '', constraints: {} },
    });
  });

  it('turns a task to an advanced schedule, without a first time of its own, and shows its fields (ADR-0004 §3)', async () => {
    const { membership, taskId } = await founded();
    const advanced = {
      ...vacuum,
      version: '1',
      frequency: 'advanced',
      // Disabled with scripts, so not sent.
      start: '',
      'rule-0-kind': 'weeks',
      'rule-0-every': '2',
      'rule-0-days': ['1', '4'],
      'rule-0-start': '2026-10-12',
    };
    expect(
      await saved({ ...on, membership }, taskId, { ...advanced, change: 'add-extra' }),
    ).toMatchObject({ values: { extraDates: [''], version: 1 } });
    expect(await saved({ ...on, membership }, taskId, advanced)).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      task: {
        frequency: 'advanced',
        schedule: {
          rules: [{ kind: 'weeks', every: 2, days: [1, 4], start: '2026-10-12' }],
          extraDates: [],
          exceptionDates: [],
        },
        rules: [{ kind: 'weeks', every: '2', days: ['1', '4'], start: '2026-10-12' }],
      },
    });
  });

  it('saves who does it, and shows it again (ADR-0001 §3)', async () => {
    const { membership, taskId } = await founded();
    const robin = membership.member.id;
    const who = { ...vacuum, version: '1', minimumAge: '12', [`constraint-${robin}`]: 'bound' };
    expect(await saved({ ...on, membership }, taskId, who)).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      who: { minimumAge: '12', constraints: { [robin]: 'bound' } },
    });
    const refused = await saved({ ...on, membership }, taskId, {
      ...who,
      version: '2',
      minimumAge: '18',
    });
    expect(isActionFailure(refused) && refused.data).toMatchObject({
      invalid: ['minimumAge'],
      values: { minimumAge: '18', constraints: { [robin]: 'bound' } },
    });
  });

  it('saves set times, shows them, and goes back to any time that week (ADR-0004 §4)', async () => {
    const { membership, taskId } = await founded();
    const set = {
      ...vacuum,
      version: '1',
      when: 'set',
      fromDay: '-1',
      fromTime: '18:00',
      toDay: '0',
      toTime: '07:00',
    };
    expect(await saved({ ...on, membership }, taskId, set)).toEqual({ saved: true });
    const window = { from: { dayOffset: -1, time: '18:00' }, to: { dayOffset: 0, time: '07:00' } };
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      task: { when: 'set', fromDay: '-1', fromTime: '18:00', toDay: '0', toTime: '07:00', window },
    });
    const backwards = await saved({ ...on, membership }, taskId, {
      ...set,
      version: '2',
      fromDay: '1',
    });
    expect(isActionFailure(backwards) && backwards.data).toMatchObject({ invalid: ['window'] });
    // A form without scripts sends the window too; any time that week leaves it out.
    expect(
      await saved({ ...on, membership }, taskId, { ...set, version: '2', when: 'week' }),
    ).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      task: { when: 'week', window: undefined, version: 3 },
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

  it('saves a task as counted from when it was last done, and shows its interval (ADR-0004 §8)', async () => {
    const { membership, taskId } = await founded();
    const counted = {
      ...vacuum,
      frequency: 'since-last-done',
      everyCount: '6',
      everyUnit: 'weeks',
      version: '1',
    };
    expect(await saved({ ...on, membership }, taskId, counted)).toEqual({ saved: true });
    expect(await opened({ ...on, membership }, taskId)).toMatchObject({
      task: {
        frequency: 'since-last-done',
        every: { count: 6, unit: 'weeks' },
        everyCount: '6',
        everyUnit: 'weeks',
        onMiss: 'roll over',
        version: 2,
      },
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
