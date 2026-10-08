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

// Heads remove a household's tasks (ADR-0001 §2), as they saw them (ADR-0019 §5), with their
// schedules (ADR-0004 §1), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

/** A household in Brussels and its founding head with two factors, as the guard finds them. */
const founded = async () => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  await db.insert(passkeys).values({
    userId: account.id,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
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
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  return { db, clock, householdId: result.householdId, member };
};
type Head = Awaited<ReturnType<typeof founded>>;

const vacuum = { name: 'Vacuum', duration: 30, frequency: 'weekly', onMiss: 'roll over' };

/** Adds a task called `name` for `head`, and gives its id. */
const added = async (head: Head, name = 'Vacuum') => {
  const result = await addTask(head, { ...vacuum, name });
  if (!result.ok) throw new Error(`Not added: ${result.error}`);
  return result.taskId;
};

/** The names of the household's tasks, and how many schedules it has. */
const left = (householdId: string) =>
  inHousehold(db, householdId, async (tx) => {
    const names = await tx.select({ name: tasks.name }).from(tasks).orderBy(tasks.name);
    const kept = await tx.select({ id: schedules.id }).from(schedules);
    return { tasks: names.map(({ name }) => name), schedules: kept.length };
  });

describe('removeTask (ADR-0001 §2)', () => {
  it('removes the task and its own schedule', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(await removeTask(head, { taskId, version: 1 })).toEqual({ ok: true });
    expect(await left(head.householdId)).toEqual({ tasks: [], schedules: 0 });
  });

  it('removes only that task, and keeps the others’ schedules', async () => {
    const head = await founded();
    const taskId = await added(head, 'Vacuum');
    await added(head, 'Water the plants');
    expect(await removeTask(head, { taskId, version: 1 })).toEqual({ ok: true });
    expect(await left(head.householdId)).toEqual({ tasks: ['Water the plants'], schedules: 1 });
  });

  it('keeps a schedule another task uses, until that one goes too (ADR-0004 §1)', async () => {
    const head = await founded();
    const out = await added(head, 'Put the bins out');
    // Two tasks on one schedule, as the advanced editor will make them (ADR-0004 §1).
    const [bringIn] = await inHousehold(db, head.householdId, async (tx) => {
      const [task] = await tx
        .select({ scheduleId: tasks.scheduleId })
        .from(tasks)
        .where(eq(tasks.id, out));
      if (!task) throw new Error('No task');
      return tx
        .insert(tasks)
        .values({
          householdId: head.householdId,
          name: 'Bring the bins in',
          duration: 5,
          scheduleId: task.scheduleId,
          timing: 'flexible',
          onMiss: 'lapse',
        })
        .returning({ id: tasks.id });
    });
    if (!bringIn) throw new Error('No task');
    expect(await removeTask(head, { taskId: out, version: 1 })).toEqual({ ok: true });
    expect(await left(head.householdId)).toEqual({ tasks: ['Bring the bins in'], schedules: 1 });
    expect(await removeTask(head, { taskId: bringIn.id, version: 1 })).toEqual({ ok: true });
    expect(await left(head.householdId)).toEqual({ tasks: [], schedules: 0 });
  });

  it('removes nothing changed since the confirmation was loaded, and gives the task now (ADR-0019 §5)', async () => {
    const head = await founded();
    const taskId = await added(head);
    expect(
      await editTask(head, { ...vacuum, taskId, version: 1, start: '2026-10-08', name: 'Hoover' }),
    ).toEqual({ ok: true });
    expect(await removeTask(head, { taskId, version: 1 })).toMatchObject({
      ok: false,
      error: 'conflict',
      current: { id: taskId, name: 'Hoover', duration: 30, frequency: 'weekly', version: 2 },
    });
    expect(await left(head.householdId)).toEqual({ tasks: ['Hoover'], schedules: 1 });
    // Confirmed again, as it is now, it is removed.
    expect(await removeTask(head, { taskId, version: 2 })).toEqual({ ok: true });
    expect(await left(head.householdId)).toEqual({ tasks: [], schedules: 0 });
  });

  it('finds no task removed already, nor another household’s (TEST-4)', async () => {
    const ash = await founded();
    const theirs = await added(ash);
    const birch = await founded();
    for (const taskId of [theirs, crypto.randomUUID(), 'vacuum', undefined]) {
      expect(await removeTask(birch, { taskId, version: 1 })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    expect(await left(ash.householdId)).toEqual({ tasks: ['Vacuum'], schedules: 1 });
    expect(await removeTask(ash, { taskId: theirs, version: 1 })).toEqual({ ok: true });
    expect(await removeTask(ash, { taskId: theirs, version: 1 })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('needs the version the confirmation was loaded with', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const version of [0, 1.5, '1', undefined]) {
      expect(await removeTask(head, { taskId, version })).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await left(head.householdId)).toEqual({ tasks: ['Vacuum'], schedules: 1 });
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const head = await founded();
    const taskId = await added(head);
    for (const member of [
      { ...head.member, twoFactor: false },
      { ...head.member, role: 'adult' as const },
      { ...head.member, role: 'child' as const },
      // A profile without an account never acts for itself (ADR-0018 §4).
      { ...head.member, hasAccount: false },
    ]) {
      expect(await removeTask({ ...head, member }, { taskId, version: 1 })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await left(head.householdId)).toEqual({ tasks: ['Vacuum'], schedules: 1 });
  });
});
