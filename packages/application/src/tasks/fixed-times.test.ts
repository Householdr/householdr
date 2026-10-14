import { occurrences, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addTask } from './add-task';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { taskToEdit } from './task-to-edit';

// Tasks done at set times around their dates (ADR-0004 §4, clarification): stored with their
// window, planned in it, and skipped when it falls while the household is away (ADR-0005 §5), on
// a real database (TEST-11). Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first; the clock reads Thursday 8 October.
const week1 = '2026-10-12';

/** The bins go out the evening before collection, on Wednesdays from 14 October. */
const bins = {
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

const edge = (dayOffset: number, time: string) => ({
  dayOffset,
  time: Temporal.PlainTime.from(time),
});

/** Adds `fields` as a task, by the household's head, and gives its id. */
const added = async (h: PlannedHousehold, fields: object = bins) => {
  const result = await addTask(h.head, fields);
  if (!result.ok) throw new Error(`Not added: ${JSON.stringify(result)}`);
  return result.taskId;
};

/** How task `taskId` is timed, as stored. */
const timingOf = async (h: PlannedHousehold, taskId: string) => {
  const [row] = await h.inIt((tx) =>
    tx
      .select({
        timing: tasks.timing,
        fromDay: tasks.windowFromDay,
        fromTime: tasks.windowFromTime,
        toDay: tasks.windowToDay,
        toTime: tasks.windowToTime,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId)),
  );
  return row;
};

describe('tasks at set times (ADR-0004 §4, clarification)', () => {
  it('stores the window, which the list and the form show', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    expect(await timingOf(h, taskId)).toEqual({
      timing: 'fixed',
      fromDay: -1,
      fromTime: '18:00:00',
      toDay: 0,
      toTime: '07:00:00',
    });
    const window = { from: edge(-1, '18:00'), to: edge(0, '07:00') };
    expect(await listTasks(h.adult)).toMatchObject({ tasks: [{ name: bins.name, window }] });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({ task: { window } });
  });

  it('is any time that week unless set, and never for a task counted from when it was last done', async () => {
    const h = await plannedHousehold(db);
    const weekly = await added(h, { ...bins, when: 'week' });
    expect(await timingOf(h, weekly)).toMatchObject({ timing: 'flexible', fromDay: null });
    const monthly = await added(h, { ...bins, when: undefined, frequency: 'monthly' });
    expect(await timingOf(h, monthly)).toMatchObject({ timing: 'floating', fromDay: null });
    const oven = await added(h, {
      ...bins,
      frequency: 'since-last-done',
      everyCount: 6,
      everyUnit: 'weeks',
    });
    expect(await timingOf(h, oven)).toMatchObject({ timing: 'flexible', fromDay: null });
  });

  it('refuses a window that doesn’t run forward, lies beyond 3 days of the date, or is incomplete', async () => {
    const h = await plannedHousehold(db);
    for (const window of [
      { toDay: -1, toTime: '17:00' },
      { fromDay: 0, fromTime: '08:00' },
      { fromDay: -4 },
      { toDay: 4 },
      { toTime: '25:00' },
      { fromTime: undefined },
      { toDay: undefined },
      { fromDay: 0.5 },
    ]) {
      expect(await addTask(h.head, { ...bins, ...window })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['window'],
      });
    }
    expect(await addTask(h.head, { ...bins, when: 'sometimes' })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['when'],
    });
  });

  it('changes the window, or goes back to any time that week, from the version seen (ADR-0019 §5)', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    const later = { ...bins, taskId, version: 1, fromTime: '19:00' };
    expect(await editTask(h.head, later)).toEqual({ ok: true });
    expect(await timingOf(h, taskId)).toMatchObject({ fromTime: '19:00:00' });
    // Saved unchanged, it keeps its version.
    expect(await editTask(h.head, { ...later, version: 2 })).toEqual({ ok: true });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({ task: { version: 2 } });
    expect(await editTask(h.head, { ...later, version: 2, when: 'week' })).toEqual({ ok: true });
    expect(await timingOf(h, taskId)).toEqual({
      timing: 'flexible',
      fromDay: null,
      fromTime: null,
      toDay: null,
      toTime: null,
    });
  });
});

describe('planning tasks at set times (ADR-0004 §4, ADR-0005 §5)', () => {
  /** The household's occurrences of task `taskId`: date, window and status. */
  const occurrencesOf = (h: PlannedHousehold, taskId: string) =>
    h.inIt((tx) =>
      tx
        .select({
          date: occurrences.date,
          start: occurrences.windowStart,
          end: occurrences.windowEnd,
          status: occurrences.status,
        })
        .from(occurrences)
        .where(eq(occurrences.taskId, taskId)),
    );

  it('plans each occurrence in its window, on the local clock', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    // Tuesday 18:00 to Wednesday 07:00 in Brussels, two hours ahead of UTC in October.
    expect(await occurrencesOf(h, taskId)).toEqual([
      {
        date: '2026-10-14',
        start: new Date('2026-10-13T16:00:00Z'),
        end: new Date('2026-10-14T05:00:00Z'),
        status: 'open',
      },
    ]);
    expect((await h.plan(week1))?.rows).toMatchObject([
      { task: bins.name, date: '2026-10-14', status: 'open' },
    ]);
  });

  it('skips one whose whole window falls while the household is away, also drafted again', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h);
    await h.away('2026-10-13', '2026-10-14');
    await draftPlan(h.scheduler, { week: week1 });
    expect(await occurrencesOf(h, taskId)).toMatchObject([{ date: '2026-10-14', status: 'away' }]);
    expect((await h.plan(week1))?.rows).toEqual([]);
    // Drafted again, it is skipped again, once.
    expect(await draftPlan(h.head, { week: week1 })).toMatchObject({ ok: true });
    expect(await occurrencesOf(h, taskId)).toMatchObject([{ status: 'away' }]);
  });
});
