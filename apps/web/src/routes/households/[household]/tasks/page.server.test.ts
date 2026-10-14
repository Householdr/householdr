import { addTask, createHousehold, membership } from '@householdr/application';
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

const opened = async (locals: object, url = new URL('https://householdr.example.org/')) => {
  try {
    return await load({ locals, url } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that adds a task, with `fields`, those with several values once for each. */
const add = async (locals: object, fields: Record<string, string | string[]>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of [value].flat()) body.append(name, each);
  }
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.add({ locals, request } as unknown as Parameters<typeof actions.add>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that adds a one-off task, with `fields`. */
const addOneOff = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  type Event = Parameters<typeof actions.addOneOff>[0];
  try {
    return await actions.addOneOff({ locals, request } as unknown as Event);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const shelf = {
  name: 'Fix the shelf',
  duration: '30',
  date: '2026-10-14',
  deadline: '',
  onMiss: 'roll over',
};

const vacuum = {
  name: 'Vacuum',
  duration: '30',
  frequency: 'weekly',
  start: '2026-10-08',
  onMiss: 'roll over',
};
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
      oneOffs: [],
      mayAddOneOffs: true,
      mayChangeTasks: true,
      starts: { earliest: '2026-10-08', latest: '2027-10-08' },
      dates: { earliest: '2026-10-08', latest: '2028-10-08' },
      shareable: [],
      removed: false,
    });
  });

  it('says a task is removed when the task’s own page leads back after removing it', async () => {
    const membership = await founded();
    const back = new URL('https://householdr.example.org/?task=removed');
    expect(await opened({ ...on, membership }, back)).toMatchObject({ removed: true });
  });

  it('adds tasks that roll over or lapse, says so, and lists them (ADR-0002 §2, ADR-0004 §3)', async () => {
    const membership = await founded();
    expect(await add({ ...on, membership }, { ...vacuum, name: ' Vacuum ' })).toEqual({
      added: 'Vacuum',
    });
    expect(
      await add({ ...on, membership }, { ...vacuum, name: 'Bins out', onMiss: 'lapse' }),
    ).toEqual({ added: 'Bins out' });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [
        { name: 'Bins out', duration: 30, frequency: 'weekly', onMiss: 'lapse' },
        { name: 'Vacuum', duration: 30, frequency: 'weekly', onMiss: 'roll over' },
      ],
    });
  });

  it('adds a task counted from when it was last done, from a form that sent both kinds of field (ADR-0004 §8)', async () => {
    const membership = await founded();
    // Without scripts, the form sends the interval and what happens if it isn't done alike.
    const oven = {
      ...vacuum,
      name: 'Oven',
      frequency: 'since-last-done',
      everyCount: '6',
      everyUnit: 'weeks',
      start: '2026-10-08',
    };
    expect(await add({ ...on, membership }, oven)).toEqual({ added: 'Oven' });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [
        {
          name: 'Oven',
          frequency: 'since-last-done',
          every: { count: 6, unit: 'weeks' },
          dueness: { daysUntilDue: 0, progress: 1 },
          onMiss: 'roll over',
        },
      ],
    });
    const refused = await add({ ...on, membership }, { ...oven, everyCount: '' });
    expect(isActionFailure(refused) && refused.data).toMatchObject({ invalid: ['everyCount'] });
  });

  it('lists a task on an advanced schedule with its rules and days as page data (ADR-0004 §3)', async () => {
    const membership = await founded();
    const { db, clock } = test.context;
    const added = await addTask(
      { db, clock, ...membership },
      {
        ...vacuum,
        duration: 30,
        frequency: 'advanced',
        rules: [{ kind: 'weeks', every: 2, days: [1, 4], start: '2026-10-08' }],
        extraDates: ['2026-12-24'],
        exceptionDates: [],
      },
    );
    expect(added).toMatchObject({ ok: true });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [
        {
          name: 'Vacuum',
          frequency: 'advanced',
          schedule: {
            rules: [{ kind: 'weeks', every: 2, days: [1, 4], start: '2026-10-08' }],
            extraDates: ['2026-12-24'],
            exceptionDates: [],
          },
        },
      ],
    });
  });

  it('adds a task on an advanced schedule from its editor’s fields, of every kind the form sends (ADR-0004 §3)', async () => {
    const membership = await founded();
    const recycling = {
      ...vacuum,
      name: 'Recycling',
      frequency: 'advanced',
      // A form without scripts sends the fields of every kind; the kind picks.
      'rule-0-kind': 'weekdays-of-month',
      'rule-0-every': '1',
      'rule-0-days': ['1'],
      'rule-0-which': ['2', '4'],
      'rule-0-day': '2',
      'rule-0-start': '2026-10-08',
      'rule-1-kind': 'year',
      'rule-1-every': '',
      'rule-1-day': '1',
      'rule-1-start': '2027-03-03',
      extraDates: ['2026-12-24', ''],
      exceptionDates: [''],
    };
    expect(await add({ ...on, membership }, recycling)).toEqual({ added: 'Recycling' });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [
        {
          name: 'Recycling',
          schedule: {
            rules: [
              { kind: 'weekdays-of-month', every: 1, which: [2, 4], day: 2, start: '2026-10-08' },
              { kind: 'year', start: '2027-03-03' },
            ],
            extraDates: ['2026-12-24'],
            exceptionDates: [],
          },
        },
      ],
    });
  });

  it('adds and removes rows of the advanced editor without saving, keeping what was typed (CODE-10)', async () => {
    const membership = await founded();
    const typed = {
      ...vacuum,
      frequency: 'advanced',
      'rule-0-kind': 'months',
      'rule-0-every': '2',
      'rule-0-start': '2026-10-31',
      extraDates: '2026-12-24',
    };
    const rule = { kind: 'months', every: '2', days: [], which: [], day: '', start: '2026-10-31' };
    const added = { kind: 'weeks', every: '1', days: [], which: [], day: '1', start: '' };
    expect(await add({ ...on, membership }, { ...typed, change: 'add-rule' })).toMatchObject({
      values: { name: 'Vacuum', rules: [rule, added], extraDates: ['2026-12-24'] },
    });
    expect(await add({ ...on, membership }, { ...typed, change: 'remove-rule-0' })).toMatchObject({
      values: { rules: [], extraDates: ['2026-12-24'] },
    });
    expect(await add({ ...on, membership }, { ...typed, change: 'add-exception' })).toMatchObject({
      values: { rules: [rule], exceptionDates: [''] },
    });
    expect(await add({ ...on, membership }, { ...typed, change: 'remove-extra-0' })).toMatchObject({
      values: { extraDates: [] },
    });
    expect(await opened({ ...on, membership })).toMatchObject({ tasks: [] });
  });

  it('adds a task on another task’s dates, which the list says (ADR-0004 §1)', async () => {
    const membership = await founded();
    expect(await add({ ...on, membership }, { ...vacuum, name: 'Bins out' })).toEqual({
      added: 'Bins out',
    });
    const page = await opened({ ...on, membership });
    if (typeof page === 'number') throw new Error(`No page: ${String(page)}`);
    const [bins] = page.shareable;
    if (!bins) throw new Error('Nothing to share.');
    // A form without scripts sends the fields of the other kinds too.
    const back = {
      ...vacuum,
      name: 'Bins in',
      frequency: 'shared',
      sharedWith: bins.id,
      start: '',
      'rule-0-kind': 'weeks',
      'rule-0-every': '1',
      'rule-0-start': '2026-10-08',
    };
    expect(await add({ ...on, membership }, back)).toEqual({ added: 'Bins in' });
    expect(await opened({ ...on, membership })).toMatchObject({
      tasks: [
        { name: 'Bins in', frequency: 'weekly', sharedWith: ['Bins out'] },
        { name: 'Bins out', frequency: 'weekly', sharedWith: ['Bins in'] },
      ],
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
    const typed = {
      name: '   ',
      duration: '0',
      frequency: 'hourly',
      start: '2026-10-07',
      onMiss: 'never',
    };
    const refused = await add({ ...on, membership }, typed);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { invalid: ['name', 'duration', 'frequency', 'start', 'onMiss'], values: typed },
    });
    expect(await opened({ ...on, membership })).toMatchObject({ tasks: [] });
  });

  it('shows other members the tasks, but adds none of theirs (ADR-0001 §2)', async () => {
    const head = await founded();
    await add({ ...on, membership: head }, vacuum);
    const adult = asAdult(head);
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      tasks: [{ name: 'Vacuum' }],
      mayChangeTasks: false,
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

describe('one-off tasks on the tasks page (ADR-0004 §4, ADR-0006 §3)', () => {
  it('lets every member with an account add one, and lists them by date', async () => {
    const head = await founded();
    const adult = asAdult(head);
    expect(await addOneOff({ ...on, membership: adult }, shelf)).toEqual({
      addedOneOff: 'Fix the shelf',
    });
    expect(
      await addOneOff(
        { ...on, membership: head },
        { ...shelf, name: 'Post the parcel', date: '2026-10-09', deadline: '2026-10-16' },
      ),
    ).toEqual({ addedOneOff: 'Post the parcel' });
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      oneOffs: [
        {
          name: 'Post the parcel',
          date: '2026-10-09',
          deadline: '2026-10-16',
          done: false,
          // Robin's own, as the head or as an adult (ADR-0006 §3, clarification).
          mayChange: true,
        },
        { name: 'Fix the shelf', date: '2026-10-14', deadline: undefined, mayChange: true },
      ],
      mayAddOneOffs: true,
    });
  });

  it('keeps what was typed in the one-off form, and names the fields that won’t do (UI-10)', async () => {
    const membership = await founded();
    const typed = { ...shelf, name: ' ', date: '2026-10-07', deadline: '2026-10-01' };
    const refused = await addOneOff({ ...on, membership }, typed);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { invalidOneOff: ['name', 'date', 'deadline'], oneOffValues: typed },
    });
  });

  it('is forbidden to a profile without an account, and not found while the tasks’ flag is off', async () => {
    const { householdId, member } = await founded();
    const profile = { householdId, member: { ...member, hasAccount: false } };
    expect(await addOneOff({ ...on, membership: profile }, shelf)).toBe(403);
    const off = { flags: { tasks: false } };
    expect(await addOneOff({ ...off, membership: { householdId, member } }, shelf)).toBe(404);
  });
});
