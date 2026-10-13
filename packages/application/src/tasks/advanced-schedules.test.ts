import { occurrences, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addTask } from './add-task';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { taskToEdit } from './task-to-edit';

// Tasks on a schedule of the advanced editor (ADR-0004 §3, clarifications): stored as its rules
// and dates, read back, changed, and planned on the dates they produce, on a real database
// (TEST-11). Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first; the clock reads Thursday 8 October.
const week1 = '2026-10-12';

/**
 * The recycling goes out on the 2nd and 4th Tuesday, and the glass every other Thursday; once on
 * a Saturday as well, and not on Thursday 15 October.
 */
const recycling = {
  name: 'Take the recycling out',
  duration: 10,
  frequency: 'advanced',
  rules: [
    { kind: 'weekdays-of-month', every: 1, which: [2, 4], day: 2, start: '2026-10-08' },
    { kind: 'weeks', every: 2, days: [4], start: '2026-10-08' },
  ],
  extraDates: ['2026-10-17'],
  exceptionDates: ['2026-10-15'],
  onMiss: 'lapse',
  when: 'set',
  fromDay: 0,
  fromTime: '08:00',
  toDay: 0,
  toTime: '20:00',
};

const day = (iso: string) => Temporal.PlainDate.from(iso);

/** Adds `fields` as a task, by the household's head, and gives its id. */
const added = async (h: PlannedHousehold, fields: object = recycling) => {
  const result = await addTask(h.head, fields);
  if (!result.ok) throw new Error(`Not added: ${JSON.stringify(result)}`);
  return result.taskId;
};

/** The schedule of task `taskId`, as stored, and how the task is timed. */
const storedOf = async (h: PlannedHousehold, taskId: string) => {
  const [row] = await h.inIt((tx) =>
    tx
      .select({
        rules: schedules.rules,
        extraDates: schedules.extraDates,
        exceptionDates: schedules.exceptionDates,
        timing: tasks.timing,
      })
      .from(tasks)
      .innerJoin(schedules, eq(schedules.id, tasks.scheduleId))
      .where(eq(tasks.id, taskId)),
  );
  return row;
};

/** The version task `taskId` is at now. */
const versionOf = async (h: PlannedHousehold, taskId: string) => {
  const result = await taskToEdit(h.head, { taskId });
  if (!result.ok) throw new Error('No such task.');
  return result.task.version;
};

describe('tasks on an advanced schedule (ADR-0004 §3, clarifications)', () => {
  it('stores the rules and dates, which the list and the form read back', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    expect(await storedOf(h, taskId)).toEqual({
      rules: [
        { rrule: 'FREQ=MONTHLY;BYDAY=2TU,4TU', start: '2026-10-08' },
        { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', start: '2026-10-08' },
      ],
      extraDates: ['2026-10-17'],
      exceptionDates: ['2026-10-15'],
      timing: 'fixed',
    });
    const schedule = {
      rules: [
        { kind: 'weekdays-of-month', every: 1, which: [2, 4], day: 2, start: day('2026-10-08') },
        { kind: 'weeks', every: 2, days: [4], start: day('2026-10-08') },
      ],
      extraDates: [day('2026-10-17')],
      exceptionDates: [day('2026-10-15')],
    };
    expect(await listTasks(h.adult)).toMatchObject({
      tasks: [{ name: recycling.name, frequency: 'advanced', schedule }],
    });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { frequency: 'advanced', schedule, start: day('2026-10-08') },
    });
  });

  it('is flexible any time that week, and fixed at set times', async () => {
    const h = await plannedHousehold(db);
    const anyTime = await added(h, { ...recycling, when: 'week' });
    expect(await storedOf(h, anyTime)).toMatchObject({ timing: 'flexible' });
  });

  it('is planned on the dates its rules and extra dates give, without the exceptions', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h, { ...recycling, when: 'week' });
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const planned = await h.inIt((tx) =>
      tx
        .select({ date: occurrences.date })
        .from(occurrences)
        .where(eq(occurrences.taskId, taskId))
        .orderBy(occurrences.date),
    );
    // Tuesday 13 October is the 2nd; Thursday 15 October is left out; Saturday 17 is added.
    expect(planned.map(({ date }) => date)).toEqual(['2026-10-13', '2026-10-17']);
  });

  it('takes a schedule of extra dates only', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h, { ...recycling, rules: [], exceptionDates: [] });
    expect(await storedOf(h, taskId)).toMatchObject({ rules: [], extraDates: ['2026-10-17'] });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { schedule: { rules: [] }, start: day('2026-10-17') },
    });
  });

  it('refuses a schedule beyond the limits, naming what is wrong', async () => {
    const h = await plannedHousehold(db);
    const [monthly, weekly] = recycling.rules;
    const refused = async (fields: object) => {
      const result = await addTask(h.head, { ...recycling, ...fields });
      return result.ok ? [] : result.error === 'invalid' ? result.fields : [result.error];
    };
    expect(await refused({ rules: Array.from({ length: 6 }).fill(weekly) })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...weekly, every: 53 }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...monthly, every: 13 }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...weekly, days: [] }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...weekly, days: [4, 4] }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...weekly, start: '2026-10-07' }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ ...weekly, start: '2027-10-09' }] })).toEqual(['rules']);
    expect(await refused({ rules: [{ kind: 'days', every: 1, start: '2026-10-08' }] })).toEqual([
      'rules',
    ]);
    expect(await refused({ rules: [], extraDates: [] })).toEqual(['rules']);
    expect(await refused({ extraDates: ['2026-10-07'] })).toEqual(['extraDates']);
    expect(await refused({ extraDates: ['2028-10-09'] })).toEqual(['extraDates']);
    expect(await refused({ exceptionDates: ['2026-10-15', '2026-10-15'] })).toEqual([
      'exceptionDates',
    ]);
    expect(await refused({ onMiss: undefined })).toEqual(['onMiss']);
    // The task's own first time is for the other kinds; the rules have theirs.
    expect(await refused({ start: '2020-01-01' })).toEqual(['start']);
    expect(await refused({ start: undefined })).toEqual([]);
  });

  it('changes the rules and dates of its schedule, and keeps a version when nothing changed', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    const version = await versionOf(h, taskId);
    expect(await editTask(h.head, { ...recycling, taskId, version })).toEqual({ ok: true });
    expect(await versionOf(h, taskId)).toBe(version);
    const changed = {
      ...recycling,
      rules: [{ kind: 'months', every: 2, start: '2026-10-31' }],
      extraDates: [],
      exceptionDates: ['2026-12-31'],
    };
    expect(await editTask(h.head, { ...changed, taskId, version })).toEqual({ ok: true });
    expect(await storedOf(h, taskId)).toMatchObject({
      rules: [{ rrule: 'FREQ=MONTHLY;INTERVAL=2', start: '2026-10-31' }],
      extraDates: [],
      exceptionDates: ['2026-12-31'],
    });
    expect(await versionOf(h, taskId)).toBe(version + 1);
  });

  it('keeps first times and dates the schedule has already, even once passed', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    // As if the schedule had been made in the summer.
    await h.inIt((tx) =>
      tx
        .update(schedules)
        .set({
          rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=TH', start: '2026-07-02' }],
          extraDates: ['2026-08-01'],
          exceptionDates: ['2026-07-09'],
        })
        .where(eq(schedules.householdId, h.householdId)),
    );
    const version = await versionOf(h, taskId);
    const summer = {
      ...recycling,
      rules: [{ kind: 'weeks', every: 1, days: [4], start: '2026-07-02' }],
      extraDates: ['2026-08-01', '2026-10-24'],
      exceptionDates: ['2026-07-09'],
      taskId,
      version,
    };
    expect(await editTask(h.head, summer)).toEqual({ ok: true });
    const later = { ...summer, version: version + 1 };
    expect(await editTask(h.head, { ...later, extraDates: ['2026-08-02'] })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['extraDates'],
    });
    expect(
      await editTask(h.head, {
        ...later,
        rules: [{ kind: 'weeks', every: 1, days: [4], start: '2026-07-03' }],
      }),
    ).toEqual({ ok: false, error: 'invalid', fields: ['rules'] });
  });

  it('moves between a simple frequency and an advanced schedule', async () => {
    const h = await plannedHousehold(db);
    const simple = {
      name: 'Water the plants',
      duration: 5,
      frequency: 'weekly',
      start: '2026-10-10',
      onMiss: 'roll over',
    };
    const taskId = await added(h, simple);
    const version = await versionOf(h, taskId);
    expect(await editTask(h.head, { ...recycling, taskId, version })).toEqual({ ok: true });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { frequency: 'advanced' },
    });
    const back = await editTask(h.head, { ...simple, taskId, version: version + 1 });
    expect(back).toEqual({ ok: true });
    expect(await storedOf(h, taskId)).toEqual({
      rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-10' }],
      extraDates: [],
      exceptionDates: [],
      timing: 'flexible',
    });
  });

  it('reads a schedule that is exactly a simple frequency as that frequency', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h, {
      ...recycling,
      rules: [{ kind: 'months', every: 3, start: '2026-10-20' }],
      extraDates: [],
      exceptionDates: [],
    });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { frequency: 'tri-monthly', start: day('2026-10-20') },
    });
  });
});
