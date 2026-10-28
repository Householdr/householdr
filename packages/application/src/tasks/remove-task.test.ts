import { accounts, inHousehold, passkeys, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { createHousehold } from '../households/create-household';
import { membership } from '../households/membership';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { settableClock } from '../testing';
import { addTask } from './add-task';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { removeTask } from './remove-task';
import { taskToEdit } from './task-to-edit';

// Heads remove a household's tasks (ADR-0001 §2), as they saw them (ADR-0019 §5), with their
// schedules (ADR-0004 §1), and hide those that have been planned (ADR-0001 §1, clarification), on
// a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

/** A household in Brussels and its founding head with two factors, as the guard finds them. */
const founded = async () => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${crypto.randomUUID()}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  await db.insert(passkeys).values({
    userId: account.id,
    publicKey: 'a-key',
    credentialID: `credential-${crypto.randomUUID()}`,
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

// The week of Monday 12 October 2026, the household's first, and the two after it.
const week1 = '2026-10-12';
const week2 = '2026-10-19';
const week3 = '2026-10-26';

/** Drafts the week of `week` as the scheduler, and publishes it unless said otherwise. */
const planned = async (h: PlannedHousehold, week: string, { publish = true } = {}) => {
  const drafted = await draftPlan(h.scheduler, { week });
  if (!drafted.ok) throw new Error(`Not drafted: ${drafted.error}`);
  if (publish) await publishPlan(h.scheduler, { week });
};

/** The tasks and dates of the plan of the week starting on `week`, with their status. */
const rowsOf = async (h: PlannedHousehold, week: string) =>
  (await h.plan(week))?.rows.map(({ task, date, status }) => `${task}@${date} ${status}`);

/** The names of the tasks the household's members see. */
const listed = async (h: PlannedHousehold) => {
  const result = await listTasks(h.adult);
  if (!result.ok) throw new Error(`Not listed: ${result.error}`);
  return result.tasks.map(({ name }) => name);
};

describe('removing a task that has been planned (ADR-0001 §1, clarification)', () => {
  it('hides it: out of the list, the drafts and this week’s plan, while what was done stays', async () => {
    const h = await plannedHousehold(db);
    const dishes = await h.task('Dishes', 20, 'weekly', '2026-10-12');
    await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await planned(h, week1);
    // Wednesday 14 October: the first dishes are done, and next week is drafted.
    h.clock.advance({ hours: 6 * 24 });
    const [first] = (await h.plan(week1))?.rows.filter((row) => row.task === 'Dishes') ?? [];
    if (!first) throw new Error('No dishes');
    expect(await completeOccurrence(h.head, { occurrence: first.occurrence })).toMatchObject({
      ok: true,
    });
    await planned(h, week2, { publish: false });
    const draftVersion = (await h.plan(week2))?.version;

    expect(await removeTask(h.head, { taskId: dishes, version: 1 })).toEqual({ ok: true });

    expect(await listed(h)).toEqual(['Vacuum']);
    expect(await rowsOf(h, week1)).toEqual(['Dishes@2026-10-12 done', 'Vacuum@2026-10-14 open']);
    expect(await rowsOf(h, week2)).toEqual(['Vacuum@2026-10-21 open']);
    // The draft changed, so a head publishes it as it is now (ADR-0019 §5).
    expect((await h.plan(week2))?.version).toBe((draftVersion ?? 0) + 1);
    // Kept by its name for what was done, but nobody can change it or remove it again.
    const [kept] = await h.inIt((tx) =>
      tx.select({ removed: tasks.removed }).from(tasks).where(eq(tasks.id, dishes)),
    );
    expect(kept).toEqual({ removed: true });
    expect(await taskToEdit(h.head, { taskId: dishes })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await removeTask(h.head, { taskId: dishes, version: 2 })).toEqual({
      ok: false,
      error: 'not-found',
    });
    // Drafted again, and the week after, it is never planned again.
    expect(await draftPlan(h.head, { week: week2 })).toMatchObject({ ok: true });
    expect(await rowsOf(h, week2)).toEqual(['Vacuum@2026-10-21 open']);
  });

  it('leaves an earlier week’s plan as it was, and never carries its open occurrence over again', async () => {
    const h = await plannedHousehold(db);
    const shelf = await h.oneOff('Fix the shelf', 30, '2026-10-14');
    await planned(h, week1);
    // Nobody fixed it in its week, so it rolls over into the next (ADR-0002 §2).
    h.clock.advance({ hours: 11 * 24 });
    await planned(h, week2);
    expect(await rowsOf(h, week2)).toEqual(['Fix the shelf@2026-10-14 open']);

    expect(await removeTask(h.head, { taskId: shelf, version: 1 })).toEqual({ ok: true });

    expect(await rowsOf(h, week1)).toEqual(['Fix the shelf@2026-10-14 open']);
    expect(await rowsOf(h, week2)).toEqual([]);
    await planned(h, week3, { publish: false });
    expect(await rowsOf(h, week3)).toEqual([]);
  });

  it('takes it out of a plan published early for a week to come', async () => {
    const h = await plannedHousehold(db);
    const vacuum = await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    await planned(h, week1);
    await planned(h, week2);
    expect(await removeTask(h.head, { taskId: vacuum, version: 1 })).toEqual({ ok: true });
    expect(await rowsOf(h, week1)).toEqual([]);
    expect(await rowsOf(h, week2)).toEqual([]);
    // Nothing was done or is left in a past plan, so it goes altogether, schedule and all.
    expect(await h.inIt((tx) => tx.select({ id: tasks.id }).from(tasks))).toEqual([]);
    expect(await h.inIt((tx) => tx.select({ id: schedules.id }).from(schedules))).toEqual([]);
  });
});
