import { assignments, members, occurrences, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { editTask } from './edit-task';
import { taskToEdit } from './task-to-edit';

// A task's minimum age and constraints (ADR-0001 §3 with its clarification): set by heads on the
// task's page, and kept to when plans are drafted (§7), on a real database (TEST-11). Invented data
// (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first; the clock reads Thursday 8 October.
const week1 = '2026-10-12';

/** Kim, a child of 10 without an account, in the household from before its plans. */
const withChild = async (h: PlannedHousehold) => {
  const [kim] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({
        householdId: h.householdId,
        name: 'Kim',
        role: 'child',
        birthDate: '2016-03-01',
        joinedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .returning({ id: members.id }),
  );
  if (!kim) throw new Error('No child');
  return kim.id;
};

/** The task's form as it shows a daily task added by `h.task`. */
const daily = (taskId: string, version: number) => ({
  taskId,
  version,
  name: 'Feed the cat',
  duration: 5,
  frequency: 'daily',
  start: '2026-10-12',
  onMiss: 'roll over',
});

/** Who the week's occurrences of task `taskId` went to, and why, as drafted. */
const assigned = async (h: PlannedHousehold, taskId: string) =>
  h.inIt((tx) =>
    tx
      .select({ memberId: assignments.memberId, reason: assignments.reason })
      .from(assignments)
      .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
      .where(eq(occurrences.taskId, taskId)),
  );

describe('minimum ages and constraints (ADR-0001 §3, clarification)', () => {
  it('are set on the task’s page, which offers every member', async () => {
    const h = await plannedHousehold(db);
    const kim = await withChild(h);
    const taskId = await h.task('Feed the cat', 5, 'daily', '2026-10-12');
    const rules = {
      minimumAge: 12,
      constraints: [
        { memberId: h.alex, constraint: 'excluded' },
        { memberId: kim, constraint: 'allowed' },
      ],
    };
    expect(await editTask(h.head, { ...daily(taskId, 1), ...rules })).toEqual({ ok: true });
    const result = await taskToEdit(h.head, { taskId });
    if (!result.ok) throw new Error('No task');
    expect(result.task.minimumAge).toBe(12);
    expect(result.task.constraints).toHaveLength(2);
    expect(result.task.constraints).toEqual(expect.arrayContaining(rules.constraints));
    expect(result.task.version).toBe(2);
    expect(result.members).toEqual([
      { id: h.alex, name: 'Alex', child: false },
      { id: kim, name: 'Kim', child: true },
      { id: h.robin, name: 'Robin', child: false },
    ]);
    // Sent again as they are, nothing changes.
    expect(await editTask(h.head, { ...daily(taskId, 2), ...rules })).toEqual({ ok: true });
    expect((await taskToEdit(h.head, { taskId })).ok && result.task.version).toBe(2);
    // Sent without, they go.
    expect(await editTask(h.head, daily(taskId, 2))).toEqual({ ok: true });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { constraints: [], version: 3 },
    });
  });

  it('refuse an age outside 1 to 17, and a member twice or not of the household', async () => {
    const h = await plannedHousehold(db);
    const other = await plannedHousehold(db);
    const taskId = await h.task('Feed the cat', 5, 'daily', '2026-10-12');
    const refused = async (fields: object) => {
      const result = await editTask(h.head, { ...daily(taskId, 1), ...fields });
      return result.ok ? [] : result.error === 'invalid' ? result.fields : [result.error];
    };
    expect(await refused({ minimumAge: 0 })).toEqual(['minimumAge']);
    expect(await refused({ minimumAge: 18 })).toEqual(['minimumAge']);
    expect(await refused({ minimumAge: 7.5 })).toEqual(['minimumAge']);
    const bound = (memberId: string) => ({ memberId, constraint: 'bound' });
    expect(await refused({ constraints: [bound(other.alex)] })).toEqual(['constraints']);
    expect(await refused({ constraints: [bound(h.alex), bound(h.alex)] })).toEqual(['constraints']);
    expect(await refused({ constraints: [{ memberId: h.alex, constraint: 'always' }] })).toEqual([
      'constraints',
    ]);
  });

  it('give a bound task to its member, and an excluded one never', async () => {
    const h = await plannedHousehold(db);
    const cat = await h.task('Feed the cat', 5, 'daily', '2026-10-12');
    const dog = await h.task('Walk the dog', 30, 'daily', '2026-10-12');
    await editTask(h.head, {
      ...daily(cat, 1),
      constraints: [{ memberId: h.alex, constraint: 'bound' }],
    });
    await editTask(h.head, {
      ...daily(dog, 1),
      name: 'Walk the dog',
      duration: 30,
      constraints: [{ memberId: h.robin, constraint: 'excluded' }],
    });
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const cats = await assigned(h, cat);
    expect(cats).toHaveLength(7);
    expect(cats.every(({ memberId, reason }) => memberId === h.alex && reason === 'bound')).toBe(
      true,
    );
    const dogs = await assigned(h, dog);
    expect(dogs).toHaveLength(7);
    expect(dogs.every(({ memberId }) => memberId === h.alex)).toBe(true);
  });

  it('keep a child below the minimum age off a task, unless a head allows it', async () => {
    const h = await plannedHousehold(db);
    await withChild(h);
    const cat = await h.task('Feed the cat', 5, 'daily', '2026-10-12');
    // Only Kim may do it, and Kim is 10.
    const others = [
      { memberId: h.robin, constraint: 'excluded' },
      { memberId: h.alex, constraint: 'excluded' },
    ];
    await editTask(h.head, { ...daily(cat, 1), minimumAge: 12, constraints: others });
    expect(await draftPlan(h.scheduler, { week: week1 })).toMatchObject({ ok: true });
    // Nobody is eligible, so it stays unassigned, and heads are told (§7, clarification).
    const nobody = await assigned(h, cat);
    expect(nobody).toHaveLength(7);
    expect(nobody.every(({ memberId }) => memberId === null)).toBe(true);

    const h2 = await plannedHousehold(db);
    const kim2 = await withChild(h2);
    const cat2 = await h2.task('Feed the cat', 5, 'daily', '2026-10-12');
    const allowed = [
      { memberId: h2.robin, constraint: 'excluded' },
      { memberId: h2.alex, constraint: 'excluded' },
      { memberId: kim2, constraint: 'allowed' },
    ];
    await editTask(h2.head, { ...daily(cat2, 1), minimumAge: 12, constraints: allowed });
    expect(await draftPlan(h2.scheduler, { week: week1 })).toMatchObject({ ok: true });
    const kims = await assigned(h2, cat2);
    expect(kims).toHaveLength(7);
    expect(kims.every(({ memberId }) => memberId === kim2)).toBe(true);
  });
});
