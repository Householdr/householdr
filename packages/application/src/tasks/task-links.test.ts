import { assignments, occurrences, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addOneOff } from './add-one-off';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { removeTask } from './remove-task';
import { taskToEdit } from './task-to-edit';

// Same-person links (ADR-0001 §7 with its clarifications): set by heads on the task's page, shown
// in the list, and kept to when plans are drafted, also across weeks, on a real database (TEST-11).
// Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// Weeks start on Mondays; the clock reads Thursday 8 October 2026.
const week1 = '2026-10-12';
const week2 = '2026-10-19';

/** The task's form for a weekly task added by `h.task`, linked to `linkedTo` if given. */
const weekly = (taskId: string, name: string, start: string, linkedTo?: string) => ({
  taskId,
  version: 1,
  name,
  duration: 10,
  frequency: 'weekly',
  start,
  onMiss: 'roll over',
  ...(linkedTo && { linkedTo }),
});

/** Who the occurrence of task `taskId` on `date` went to, and why. */
const assignedOn = (h: PlannedHousehold, taskId: string, date: string) =>
  h.inIt((tx) =>
    tx
      .select({ memberId: assignments.memberId, reason: assignments.reason })
      .from(assignments)
      .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
      .where(and(eq(occurrences.taskId, taskId), eq(occurrences.date, date))),
  );

describe('same-person links (ADR-0001 §7, clarification)', () => {
  it('are set on the task’s page and shown in the list', async () => {
    const h = await plannedHousehold(db);
    const out = await h.task('Put the bins out', 10, 'weekly', '2026-10-13');
    const back = await h.task('Bring the bins in', 10, 'weekly', '2026-10-14');
    expect(await editTask(h.head, weekly(out, 'Put the bins out', '2026-10-13', back))).toEqual({
      ok: true,
    });
    expect(await taskToEdit(h.head, { taskId: out })).toMatchObject({
      task: { linkedTo: back },
      linkable: [{ id: back, name: 'Bring the bins in' }],
    });
    expect(await listTasks(h.adult)).toMatchObject({
      tasks: [
        { name: 'Bring the bins in' },
        { name: 'Put the bins out', linkedTo: 'Bring the bins in' },
      ],
    });
  });

  it('refuse a one-off task, the task itself, or one not of the household', async () => {
    const h = await plannedHousehold(db);
    const out = await h.task('Put the bins out', 10, 'weekly', '2026-10-13');
    const other = await plannedHousehold(db);
    const theirs = await other.task('Bring the bins in', 10, 'weekly', '2026-10-14');
    const shelf = await addOneOff(h.adult, {
      name: 'Fix the shelf',
      duration: 30,
      date: '2026-10-14',
      onMiss: 'roll over',
    });
    if (!shelf.ok) throw new Error('No one-off');
    for (const linkedTo of [shelf.taskId, out, theirs, crypto.randomUUID()]) {
      expect(
        await editTask(h.head, weekly(out, 'Put the bins out', '2026-10-13', linkedTo)),
      ).toEqual({ ok: false, error: 'invalid', fields: ['linkedTo'] });
    }
  });

  it('give the linked task’s next occurrence to the same member', async () => {
    const h = await plannedHousehold(db);
    const out = await h.task('Put the bins out', 10, 'weekly', '2026-10-13');
    const back = await h.task('Bring the bins in', 10, 'weekly', '2026-10-14');
    await editTask(h.head, weekly(out, 'Put the bins out', '2026-10-13', back));
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const [outBy] = await assignedOn(h, out, '2026-10-13');
    const [backBy] = await assignedOn(h, back, '2026-10-14');
    expect(outBy?.memberId).toBeTruthy();
    expect(backBy?.memberId).toBe(outBy?.memberId);
  });

  it('carry over into the next week, with the reason “linked”', async () => {
    const h = await plannedHousehold(db);
    // Out on Sundays, the last day of a plan week; in on Mondays, the first of the next.
    const out = await h.task('Put the bins out', 10, 'weekly', '2026-10-18');
    const back = await h.task('Bring the bins in', 10, 'weekly', '2026-10-19');
    await editTask(h.head, weekly(out, 'Put the bins out', '2026-10-18', back));
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const outBy = await h.inIt((tx) =>
      tx
        .select({ memberId: assignments.memberId })
        .from(assignments)
        .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
        .where(eq(occurrences.taskId, out)),
    );
    expect(outBy).toHaveLength(1);
    expect(await draftPlan(h.scheduler, { week: week2 })).toMatchObject({ ok: true });
    const backBy = await h.inIt((tx) =>
      tx
        .select({
          date: occurrences.date,
          memberId: assignments.memberId,
          reason: assignments.reason,
        })
        .from(assignments)
        .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
        .where(eq(occurrences.taskId, back)),
    );
    expect(backBy).toEqual([
      { date: '2026-10-19', memberId: outBy[0]?.memberId, reason: 'linked' },
    ]);
  });

  it('go when the task linked to is removed', async () => {
    const h = await plannedHousehold(db);
    const out = await h.task('Put the bins out', 10, 'weekly', '2026-10-13');
    const back = await h.task('Bring the bins in', 10, 'weekly', '2026-10-14');
    await editTask(h.head, weekly(out, 'Put the bins out', '2026-10-13', back));
    expect(await removeTask(h.head, { taskId: back, version: 1 })).toMatchObject({ ok: true });
    const result = await taskToEdit(h.head, { taskId: out });
    expect(result.ok && result.task.linkedTo).toBeUndefined();
  });
});
