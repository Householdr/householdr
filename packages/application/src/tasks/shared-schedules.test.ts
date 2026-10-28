import { occurrences, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addTask } from './add-task';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { removeTask } from './remove-task';
import { taskToEdit } from './task-to-edit';

// Tasks that share a schedule (ADR-0004 §1, clarification): one schedule, each task with its own
// timing, its dates changed for all or given apart, on a real database (TEST-11). Invented data
// (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first; the clock reads Thursday 8 October.
const week1 = '2026-10-12';

/** The bins go out the evening before collection, every Wednesday from 14 October. */
const out = {
  name: 'Put the bins out',
  duration: 5,
  frequency: 'weekly',
  start: '2026-10-14',
  onMiss: 'lapse',
  when: 'set',
  fromDay: -1,
  fromTime: '18:00',
  toDay: 0,
  toTime: '07:00',
};

/** And come back in on the day itself, any time from noon. */
const back = (sharedWith: string) => ({
  name: 'Bring the bins in',
  duration: 5,
  frequency: 'shared',
  sharedWith,
  onMiss: 'roll over',
  when: 'set',
  fromDay: 0,
  fromTime: '12:00',
  toDay: 0,
  toTime: '22:00',
});

/** Adds `fields` as a task, by the household's head, and gives its id. */
const added = async (h: PlannedHousehold, fields: object) => {
  const result = await addTask(h.head, fields);
  if (!result.ok) throw new Error(`Not added: ${JSON.stringify(result)}`);
  return result.taskId;
};

/** The schedule and timing of task `taskId`, as stored. */
const storedOf = async (h: PlannedHousehold, taskId: string) => {
  const [row] = await h.inIt((tx) =>
    tx
      .select({ scheduleId: tasks.scheduleId, timing: tasks.timing, rules: schedules.rules })
      .from(tasks)
      .leftJoin(schedules, eq(schedules.id, tasks.scheduleId))
      .where(eq(tasks.id, taskId)),
  );
  if (!row) throw new Error('No such task.');
  return row;
};

/** How many schedules the household has. */
const schedulesOf = async (h: PlannedHousehold) =>
  (await h.inIt((tx) => tx.select({ id: schedules.id }).from(schedules))).length;

/** The version task `taskId` is at now. */
const versionOf = async (h: PlannedHousehold, taskId: string) => {
  const result = await taskToEdit(h.head, { taskId });
  if (!result.ok) throw new Error('No such task.');
  return result.task.version;
};

describe('tasks that share a schedule (ADR-0004 §1, clarification)', () => {
  it('follow one schedule, each with its own timing, and the list says which', async () => {
    const h = await plannedHousehold(db);
    const outId = await added(h, out);
    const backId = await added(h, back(outId));
    const [outRow, backRow] = [await storedOf(h, outId), await storedOf(h, backId)];
    expect(backRow.scheduleId).toBe(outRow.scheduleId);
    expect(await schedulesOf(h)).toBe(1);
    expect(await listTasks(h.adult)).toMatchObject({
      tasks: [
        { name: 'Bring the bins in', frequency: 'weekly', sharedWith: ['Put the bins out'] },
        { name: 'Put the bins out', frequency: 'weekly', sharedWith: ['Bring the bins in'] },
      ],
      shareable: [
        { id: backId, name: 'Bring the bins in' },
        { id: outId, name: 'Put the bins out' },
      ],
    });
    expect(await taskToEdit(h.head, { taskId: backId })).toMatchObject({
      task: { sharedWith: [{ id: outId, name: 'Put the bins out' }] },
      shareable: [],
    });
  });

  it('are planned on the same dates, each in its own window', async () => {
    const h = await plannedHousehold(db);
    const outId = await added(h, out);
    const backId = await added(h, back(outId));
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const planned = await h.inIt((tx) =>
      tx.select({ taskId: occurrences.taskId, date: occurrences.date }).from(occurrences),
    );
    const datesOf = (taskId: string) =>
      planned.filter((o) => o.taskId === taskId).map(({ date }) => date);
    expect(datesOf(outId)).toEqual(['2026-10-14']);
    expect(datesOf(backId)).toEqual(['2026-10-14']);
  });

  it('take the timing of the dates they share any time that week', async () => {
    const h = await plannedHousehold(db);
    const fridge = await added(h, { ...out, frequency: 'monthly', when: 'week' });
    const freezer = await added(h, { ...back(fridge), when: 'week' });
    expect(await storedOf(h, freezer)).toMatchObject({ timing: 'floating' });
  });

  it('refuse a task that has no schedule to share, or isn’t the household’s', async () => {
    const h = await plannedHousehold(db);
    const oven = await added(h, {
      name: 'Clean the oven',
      duration: 40,
      frequency: 'since-last-done',
      everyCount: 6,
      everyUnit: 'weeks',
      start: '2026-10-10',
    });
    const other = await plannedHousehold(db);
    const theirs = await added(other, out);
    for (const sharedWith of [oven, theirs, crypto.randomUUID()]) {
      expect(await addTask(h.head, back(sharedWith))).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['sharedWith'],
      });
    }
    expect(await addTask(h.head, { ...back(oven), sharedWith: undefined })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['sharedWith'],
    });
  });

  it('change their dates together, or give one dates of its own', async () => {
    const h = await plannedHousehold(db);
    const outId = await added(h, out);
    const backId = await added(h, back(outId));
    // The collection moves to Thursdays: for both.
    const thursdays = { ...out, start: '2026-10-15', taskId: outId };
    const version = await versionOf(h, outId);
    expect(await editTask(h.head, { ...thursdays, version })).toEqual({ ok: true });
    expect(await storedOf(h, backId)).toMatchObject({
      rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-15' }],
    });
    // Bringing them in moves to Fridays alone.
    const fridays = {
      ...out,
      ...back(outId),
      frequency: 'weekly',
      start: '2026-10-16',
      ownDates: true,
      taskId: backId,
      version: await versionOf(h, backId),
    };
    expect(await editTask(h.head, fridays)).toEqual({ ok: true });
    expect(await storedOf(h, backId)).toMatchObject({
      rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-16' }],
    });
    expect(await storedOf(h, outId)).toMatchObject({
      rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-15' }],
    });
    expect(await schedulesOf(h)).toBe(2);
  });

  it('join another task’s schedule, leaving their own to go', async () => {
    const h = await plannedHousehold(db);
    const outId = await added(h, out);
    const backId = await added(h, { ...back(outId), frequency: 'weekly', start: '2026-10-16' });
    expect(await schedulesOf(h)).toBe(2);
    const version = await versionOf(h, backId);
    expect(await editTask(h.head, { ...back(outId), taskId: backId, version })).toEqual({
      ok: true,
    });
    expect((await storedOf(h, backId)).scheduleId).toBe((await storedOf(h, outId)).scheduleId);
    expect(await schedulesOf(h)).toBe(1);
    // Saved again unchanged, it keeps its version.
    const now = await versionOf(h, backId);
    expect(await editTask(h.head, { ...back(outId), taskId: backId, version: now })).toEqual({
      ok: true,
    });
    expect(await versionOf(h, backId)).toBe(now);
  });

  it('keep the schedule while a task is on it, and let it go with the last', async () => {
    const h = await plannedHousehold(db);
    const outId = await added(h, out);
    const backId = await added(h, back(outId));
    const counted = {
      ...back(outId),
      frequency: 'since-last-done',
      everyCount: 1,
      everyUnit: 'weeks',
      start: '2026-10-14',
      taskId: backId,
      version: await versionOf(h, backId),
    };
    expect(await editTask(h.head, counted)).toEqual({ ok: true });
    expect(await schedulesOf(h)).toBe(1);
    expect(
      await removeTask(h.head, { taskId: outId, version: await versionOf(h, outId) }),
    ).toMatchObject({ ok: true });
    expect(await schedulesOf(h)).toBe(0);
  });
});
