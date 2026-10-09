import { accounts, inHousehold, passkeys, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from '../households/create-household';
import { membership } from '../households/membership';
import { settableClock } from '../testing';
import { addTask } from './add-task';
import { editTask } from './edit-task';
import { removeTask } from './remove-task';
import { taskToEdit, type EditableTask } from './task-to-edit';

// Heads change a household's tasks (ADR-0001 §2, ADR-0004 §3–§4) from the version they saw
// (ADR-0019 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
/** Thursday 8 October 2026, 10:00 in Brussels. */
const morning = Temporal.Instant.from('2026-10-08T08:00:00Z');

/** A household in Brussels and its founding head, as the guard finds them; with two factors unless said. */
const founded = async (twoFactor = true) => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  if (twoFactor) {
    await db.insert(passkeys).values({
      userId: account.id,
      publicKey: 'a-key',
      credentialID: `credential-${String(++next)}`,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });
  }
  const result = await createHousehold(
    {
      db,
      actor: { account: account.id, twoFactor: true },
      account: { id: account.id, managed: false, guardians: [] },
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
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account.id, result.householdId);
  if (!member) throw new Error('Not a member');
  return { db, clock: settableClock(morning), householdId: result.householdId, member };
};
type Head = Awaited<ReturnType<typeof founded>>;

const vacuum = {
  name: 'Vacuum the living room',
  duration: 30,
  frequency: 'weekly',
  start: '2026-10-12',
  onMiss: 'roll over',
};

/** Adds `vacuum`, or another task, for `head`, and gives its id. */
const added = async (head: Head, task: Partial<typeof vacuum> = {}) => {
  const result = await addTask(head, { ...vacuum, ...task });
  if (!result.ok) throw new Error(`Not added: ${result.error}`);
  return result.taskId;
};

/** The household's tasks as stored, with their schedules' rules and versions. */
const stored = (householdId: string) =>
  inHousehold(db, householdId, (tx) =>
    tx
      .select({
        name: tasks.name,
        duration: tasks.duration,
        timing: tasks.timing,
        onMiss: tasks.onMiss,
        version: tasks.version,
        rules: schedules.rules,
        scheduleVersion: schedules.version,
      })
      .from(tasks)
      .innerJoin(schedules, eq(schedules.id, tasks.scheduleId)),
  );

/** Vacuum as `added` stores it. */
const asAdded = {
  name: 'Vacuum the living room',
  duration: 30,
  timing: 'flexible',
  onMiss: 'roll over',
  version: 1,
  rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-12' }],
  scheduleVersion: 1,
};

/** A task with its first time as text, to compare: Temporal values compare by their text. */
const shown = (task: EditableTask) => ({ ...task, start: task.start.toString() });

/** The members a head's powers are refused to (ADR-0001 §2, ADR-0010 §3, ADR-0018 §4). */
const notHeads = (head: Head) => [
  { ...head.member, twoFactor: false },
  { ...head.member, role: 'adult' as const },
  { ...head.member, role: 'child' as const },
  { ...head.member, hasAccount: false },
];

describe('taskToEdit (ADR-0001 §2)', () => {
  it('gives a head the task, its version and the days its first time can be', async () => {
    const head = await founded();
    const taskId = await added(head);
    const result = await taskToEdit(head, { taskId });
    if (!result.ok) throw new Error(`Not found: ${result.error}`);
    expect(result.household).toBe('Ash Lane');
    expect(shown(result.task)).toEqual({
      id: taskId,
      name: 'Vacuum the living room',
      duration: 30,
      frequency: 'weekly',
      start: '2026-10-12',
      onMiss: 'roll over',
      version: 1,
    });
    const { earliest, latest } = result.starts;
    expect([earliest.toString(), latest.toString()]).toEqual(['2026-10-08', '2027-10-08']);
  });

  it('reaches back to a first time that has passed, so it can be kept (ADR-0004 §3)', async () => {
    const head = await founded();
    const taskId = await added(head);
    head.clock.advance({ hours: 24 * 30 });
    const result = await taskToEdit(head, { taskId });
    if (!result.ok) throw new Error(`Not found: ${result.error}`);
    const { earliest, latest } = result.starts;
    expect([earliest.toString(), latest.toString()]).toEqual(['2026-10-12', '2027-11-07']);
  });

  it('finds none of another household’s tasks, nor a task that isn’t there (TEST-4)', async () => {
    const ash = await founded();
    const theirs = await added(ash);
    const birch = await founded();
    for (const taskId of [theirs, crypto.randomUUID(), 'vacuum', 42, undefined]) {
      expect(await taskToEdit(birch, { taskId })).toEqual({ ok: false, error: 'not-found' });
    }
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const member of notHeads(head)) {
      expect(await taskToEdit({ ...head, member }, { taskId })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
  });
});

describe('editTask (ADR-0001 §2, ADR-0019 §5)', () => {
  it('renames a task, and keeps its schedule as it is', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(await editTask(head, { ...vacuum, taskId, version: 1, name: '  Hoover  ' })).toEqual({
      ok: true,
    });
    expect(await stored(head.householdId)).toEqual([{ ...asAdded, name: 'Hoover', version: 2 }]);
  });

  it('changes the minutes it takes (ADR-0001 §5)', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(await editTask(head, { ...vacuum, taskId, version: 1, duration: 45 })).toEqual({
      ok: true,
    });
    expect(await stored(head.householdId)).toEqual([{ ...asAdded, duration: 45, version: 2 }]);
  });

  it('changes what happens when it isn’t done (ADR-0002 §2)', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(await editTask(head, { ...vacuum, taskId, version: 1, onMiss: 'lapse' })).toEqual({
      ok: true,
    });
    expect(await stored(head.householdId)).toEqual([{ ...asAdded, onMiss: 'lapse', version: 2 }]);
  });

  it.each([
    ['daily', 'FREQ=DAILY', 'flexible'],
    ['biweekly', 'FREQ=WEEKLY;INTERVAL=2', 'flexible'],
    ['monthly', 'FREQ=MONTHLY', 'floating'],
    ['tri-monthly', 'FREQ=MONTHLY;INTERVAL=3', 'floating'],
    ['yearly', 'FREQ=YEARLY', 'floating'],
  ])(
    'rewrites the rule of its schedule for %s, and makes it %s (ADR-0004 §3–§4)',
    async (frequency, rrule, timing) => {
      const head = await founded();
      const taskId = await added(head);
      expect(await editTask(head, { ...vacuum, taskId, version: 1, frequency })).toEqual({
        ok: true,
      });
      expect(await stored(head.householdId)).toEqual([
        {
          ...asAdded,
          timing,
          version: 2,
          rules: [{ rrule, start: '2026-10-12' }],
          scheduleVersion: 2,
        },
      ]);
    },
  );

  it('makes a floating task flexible again with a frequency of weeks (ADR-0004 §4)', async () => {
    const head = await founded();
    const taskId = await added(head, { frequency: 'monthly' });
    expect(await stored(head.householdId)).toMatchObject([{ timing: 'floating' }]);
    expect(await editTask(head, { ...vacuum, taskId, version: 1 })).toEqual({ ok: true });
    expect(await stored(head.householdId)).toEqual([
      { ...asAdded, version: 2, scheduleVersion: 2 },
    ]);
  });

  it('moves its first time, which rewrites the rule of its schedule', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(await editTask(head, { ...vacuum, taskId, version: 1, start: '2026-10-15' })).toEqual({
      ok: true,
    });
    expect(await stored(head.householdId)).toEqual([
      {
        ...asAdded,
        version: 2,
        rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-15' }],
        scheduleVersion: 2,
      },
    ]);
  });

  it('saved unchanged, keeps the task and its schedule at their versions', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const name of ['Vacuum the living room', ' Vacuum the living room ']) {
      expect(await editTask(head, { ...vacuum, taskId, version: 1, name })).toEqual({ ok: true });
    }
    expect(await stored(head.householdId)).toEqual([asAdded]);
  });

  it('saves nothing from a version changed since, and gives the task now (ADR-0019 §5)', async () => {
    const head = await founded();
    const taskId = await added(head);
    // Another head saves first, from the same version.
    expect(await editTask(head, { ...vacuum, taskId, version: 1, name: 'Hoover' })).toEqual({
      ok: true,
    });
    const late = await editTask(head, {
      ...vacuum,
      taskId,
      version: 1,
      duration: 45,
      frequency: 'monthly',
      start: '2026-10-20',
    });
    if (late.ok || late.error !== 'conflict') throw new Error('No conflict');
    expect(shown(late.current)).toEqual({
      ...vacuum,
      id: taskId,
      name: 'Hoover',
      version: 2,
    });
    expect(await stored(head.householdId)).toEqual([{ ...asAdded, name: 'Hoover', version: 2 }]);
    // Saved again from the version the conflict gave, it is saved.
    expect(
      await editTask(head, { ...vacuum, taskId, version: 2, name: 'Hoover', duration: 45 }),
    ).toEqual({ ok: true });
    expect(await stored(head.householdId)).toEqual([
      { ...asAdded, name: 'Hoover', duration: 45, version: 3 },
    ]);
  });

  it('answers a form loaded before a change with the change, before what it refuses', async () => {
    const head = await founded();
    const taskId = await added(head, { start: '2026-10-08' });
    head.clock.advance({ hours: 24 * 30 });
    // Another head moves its first time on, from today.
    expect(await editTask(head, { ...vacuum, taskId, version: 1, start: '2026-11-07' })).toEqual({
      ok: true,
    });
    // The first time the form was loaded with has passed, and is no longer the task's.
    expect(
      await editTask(head, { ...vacuum, taskId, version: 1, start: '2026-10-08', duration: 45 }),
    ).toMatchObject({ ok: false, error: 'conflict', current: { version: 2 } });
  });

  it('keeps a first time that has passed, or moves it to a day from today on (ADR-0004 §3)', async () => {
    const head = await founded();
    const taskId = await added(head, { start: '2026-10-08' });
    // A month on, it has started: 7 November 2026.
    head.clock.advance({ hours: 24 * 30 });
    const kept = { ...vacuum, taskId, name: 'Hoover', start: '2026-10-08' };
    expect(await editTask(head, { ...kept, version: 1 })).toEqual({ ok: true });
    for (const start of ['2026-10-07', '2026-10-09', '2026-11-06', '2027-11-08']) {
      expect(await editTask(head, { ...kept, version: 2, start })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['start'],
      });
    }
    expect(await editTask(head, { ...kept, version: 2, start: '2026-11-07' })).toEqual({
      ok: true,
    });
    expect(await stored(head.householdId)).toMatchObject([
      { name: 'Hoover', version: 3, rules: [{ start: '2026-11-07' }], scheduleVersion: 2 },
    ]);
  });

  it.each([
    ['name', ['', '   ', 'x'.repeat(101), 42, undefined]],
    ['duration', [0, -5, 1441, 2.5, Number.NaN, '30', undefined]],
    ['frequency', ['', 'hourly', 'FREQ=WEEKLY', undefined]],
    ['start', ['', '2026-02-30', '8 October', 20261012, undefined]],
    ['onMiss', ['', 'skip', 'Roll over', undefined]],
  ])('refuses a %s that won’t do, and changes nothing', async (field, values) => {
    const head = await founded();
    const taskId = await added(head);
    for (const value of values) {
      expect(await editTask(head, { ...vacuum, taskId, version: 1, [field]: value })).toEqual({
        ok: false,
        error: 'invalid',
        fields: [field],
      });
    }
    expect(await stored(head.householdId)).toEqual([asAdded]);
  });

  it('names every field that isn’t valid, in the form’s order', async () => {
    const head = await founded();
    const taskId = await added(head);
    const input = {
      taskId,
      version: 1,
      onMiss: '',
      start: '',
      frequency: '',
      duration: 0,
      name: '',
    };
    expect(await editTask(head, input)).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'duration', 'frequency', 'start', 'onMiss'],
    });
  });

  it('needs the version the form was loaded with', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const version of [0, 1.5, '1', undefined]) {
      expect(await editTask(head, { ...vacuum, taskId, version, name: 'Hoover' })).toEqual({
        ok: false,
        error: 'invalid',
        fields: [],
      });
    }
    expect(await stored(head.householdId)).toEqual([asAdded]);
  });

  it('finds none of another household’s tasks, nor one removed meanwhile (TEST-4)', async () => {
    const ash = await founded();
    const theirs = await added(ash);
    const birch = await founded();
    for (const taskId of [theirs, crypto.randomUUID(), 'vacuum', undefined]) {
      expect(await editTask(birch, { ...vacuum, taskId, version: 1, name: 'Mine' })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    expect(await stored(ash.householdId)).toEqual([asAdded]);
    expect(await removeTask(ash, { taskId: theirs, version: 1 })).toEqual({ ok: true });
    expect(await editTask(ash, { ...vacuum, taskId: theirs, version: 1, name: 'Hoover' })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const member of notHeads(head)) {
      expect(
        await editTask({ ...head, member }, { ...vacuum, taskId, version: 1, name: 'Hoover' }),
      ).toEqual({ ok: false, error: 'not-allowed' });
    }
    expect(await stored(head.householdId)).toEqual([asAdded]);
  });
});
