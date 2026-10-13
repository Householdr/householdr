import { activityLog, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { householdActivity } from '../households/activity';
import type { HouseholdContext } from '../households/membership';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addOneOff } from './add-one-off';
import { editOneOff } from './edit-one-off';
import { removeOneOff } from './remove-one-off';

// Members add one-off tasks, and change or remove those they added until they are done, heads any
// (ADR-0004 §4, ADR-0006 §3, clarifications), with the activity log naming them (ADR-0018 §5,
// clarification), on a real database (TEST-11). Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026, the household's first; the clock reads Thursday 8 October.
const week1 = '2026-10-12';

const shelf = { name: 'Fix the shelf', duration: 30, date: '2026-10-14', onMiss: 'roll over' };

/** Adds `fields` as a one-off by `context`, and returns its id. */
const added = async (context: HouseholdContext, fields: object = shelf) => {
  const result = await addOneOff(context, fields);
  if (!result.ok) throw new Error(`Not added: ${result.error}`);
  return result.taskId;
};

/** The one-off `taskId` as stored, or nothing once it is gone. */
const stored = async (h: PlannedHousehold, taskId: string) => {
  const [row] = await h.inIt((tx) =>
    tx
      .select({
        name: tasks.name,
        duration: tasks.duration,
        once: tasks.once,
        deadline: tasks.deadline,
        onMiss: tasks.onMiss,
        timing: tasks.timing,
        addedBy: tasks.addedBy,
        removed: tasks.removed,
        version: tasks.version,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId)),
  );
  return row;
};

/** The household's log entries about one-offs: who, what and which task, oldest first. */
const logged = async (h: PlannedHousehold) => {
  const rows = await h.inIt((tx) =>
    tx
      .select({
        actor: activityLog.actorId,
        action: activityLog.action,
        task: activityLog.taskName,
      })
      .from(activityLog)
      .orderBy(activityLog.at, activityLog.id),
  );
  return rows.filter((row) => row.action.startsWith('one-off.'));
};

/** Plans and publishes week 1, then moves to Wednesday 14 October and does `taskId` as Alex. */
const done = async (h: PlannedHousehold, taskId: string) => {
  await draftPlan(h.scheduler, { week: week1 });
  await publishPlan(h.scheduler, { week: week1 });
  h.clock.advance({ hours: 6 * 24 });
  const [occurrence] = await h.inIt((tx) =>
    tx.query.occurrences.findMany({ where: (o, { eq: is }) => is(o.taskId, taskId) }),
  );
  if (!occurrence) throw new Error('Not planned');
  expect(await completeOccurrence(h.adult, { occurrence: occurrence.id })).toMatchObject({
    ok: true,
  });
};

describe('addOneOff (ADR-0004 §4, ADR-0006 §3)', () => {
  it('adds a one-off on its date, as the member who added it, and logs it by name', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult, { ...shelf, deadline: '2026-10-30', onMiss: 'lapse' });
    expect(await stored(h, taskId)).toEqual({
      name: 'Fix the shelf',
      duration: 30,
      once: '2026-10-14',
      deadline: '2026-10-30',
      onMiss: 'lapse',
      timing: 'flexible',
      addedBy: h.alex,
      removed: false,
      version: 1,
    });
    expect(await logged(h)).toEqual([
      { actor: h.alex, action: 'one-off.added', task: 'Fix the shelf' },
    ]);
  });

  it('is flexible within its week without a deadline, and the next draft of that week plans it', async () => {
    const h = await plannedHousehold(db);
    expect(await stored(h, await added(h.adult))).toMatchObject({ deadline: null });
    await draftPlan(h.scheduler, { week: week1 });
    expect((await h.plan(week1))?.rows.map((row) => row.task)).toEqual(['Fix the shelf']);
  });

  it('is for every member with an account, children included, and no profile without one', async () => {
    const h = await plannedHousehold(db);
    const child = { ...h.adult, member: { ...h.adult.member, role: 'child' as const } };
    expect(await addOneOff(child, shelf)).toMatchObject({ ok: true });
    expect(await addOneOff(h.head, shelf)).toMatchObject({ ok: true });
    const profile = { ...h.adult, member: { ...h.adult.member, hasAccount: false } };
    expect(await addOneOff(profile, shelf)).toEqual({ ok: false, error: 'not-allowed' });
  });

  it('takes a date from today up to a year, and a deadline from its date up to a year from today', async () => {
    const h = await plannedHousehold(db);
    for (const fields of [
      { date: '2026-10-08' },
      { date: '2027-10-08' },
      { date: '2026-10-14', deadline: '2026-10-14' },
      { date: '2026-10-14', deadline: '2027-10-08' },
    ]) {
      expect(await addOneOff(h.adult, { ...shelf, ...fields })).toMatchObject({ ok: true });
    }
    for (const [fields, field] of [
      [{ date: '2026-10-07' }, 'date'],
      [{ date: '2027-10-09' }, 'date'],
      [{ date: '2026-02-30' }, 'date'],
      [{ date: '2026-10-14', deadline: '2026-10-13' }, 'deadline'],
      [{ date: '2026-10-14', deadline: '2027-10-09' }, 'deadline'],
    ] as const) {
      expect(await addOneOff(h.adult, { ...shelf, ...fields })).toEqual({
        ok: false,
        error: 'invalid',
        fields: [field],
      });
    }
  });

  it('names every field that won’t do, in the form’s order, and adds nothing', async () => {
    const h = await plannedHousehold(db);
    expect(
      await addOneOff(h.adult, { name: ' ', duration: 0, date: 'soon', deadline: 3, onMiss: 'x' }),
    ).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'duration', 'date', 'deadline', 'onMiss'],
    });
    expect(await logged(h)).toEqual([]);
  });
});

describe('editOneOff (ADR-0006 §3, clarification)', () => {
  it('changes the member’s own one-off from the version they saw, without logging it', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    const changed = { ...shelf, name: 'Fix the shelves', duration: 45, deadline: '2026-10-25' };
    expect(await editOneOff(h.adult, { ...changed, taskId, version: 1 })).toEqual({ ok: true });
    expect(await stored(h, taskId)).toMatchObject({
      name: 'Fix the shelves',
      duration: 45,
      deadline: '2026-10-25',
      version: 2,
    });
    // Saved unchanged, it keeps its version; a deadline left out goes.
    expect(await editOneOff(h.adult, { ...changed, taskId, version: 2 })).toEqual({ ok: true });
    expect(await stored(h, taskId)).toMatchObject({ version: 2 });
    expect(
      await editOneOff(h.adult, { ...changed, deadline: undefined, taskId, version: 2 }),
    ).toEqual({ ok: true });
    expect(await stored(h, taskId)).toMatchObject({ deadline: null, version: 3 });
    expect(await logged(h)).toEqual([
      { actor: h.alex, action: 'one-off.added', task: 'Fix the shelf' },
    ]);
  });

  it('is for whoever added it until it is done, and for heads with two factors always', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    const robinAsAdult = { ...h.head, member: { ...h.head.member, role: 'adult' as const } };
    const withoutTwoFactors = { ...h.head, member: { ...h.head.member, twoFactor: false } };
    for (const context of [robinAsAdult, withoutTwoFactors]) {
      expect(await editOneOff(context, { ...shelf, taskId, version: 1, name: 'X' })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    await done(h, taskId);
    expect(await editOneOff(h.adult, { ...shelf, taskId, version: 1, name: 'X' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await editOneOff(h.head, { ...shelf, taskId, version: 1, name: 'X' })).toEqual({
      ok: true,
    });
  });

  it('saves nothing changed since the form was loaded, and gives the one-off now (ADR-0019 §5)', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    await editOneOff(h.head, { ...shelf, taskId, version: 1, name: 'Fix the shelves' });
    expect(await editOneOff(h.adult, { ...shelf, taskId, version: 1, duration: 10 })).toMatchObject(
      {
        ok: false,
        error: 'conflict',
        current: { id: taskId, name: 'Fix the shelves', duration: 30, version: 2 },
      },
    );
    expect(await stored(h, taskId)).toMatchObject({ duration: 30 });
  });

  it('keeps a date that has passed, but moves it to no other past day', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult, { ...shelf, date: '2026-10-08' });
    h.clock.advance({ hours: 3 * 24 });
    const kept = { ...shelf, date: '2026-10-08', taskId, version: 1 };
    expect(await editOneOff(h.adult, { ...kept, date: '2026-10-09' })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['date'],
    });
    expect(await editOneOff(h.adult, { ...kept, name: 'Fix it' })).toEqual({ ok: true });
    // Nor a deadline that has passed, but the one it has.
    expect(await editOneOff(h.adult, { ...kept, version: 2, deadline: '2026-10-09' })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['deadline'],
    });
  });

  it('finds no task but a one-off of the household (TEST-4)', async () => {
    const h = await plannedHousehold(db);
    const other = await plannedHousehold(db);
    const theirs = await added(other.adult);
    const vacuum = await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    for (const taskId of [theirs, vacuum, crypto.randomUUID(), 'shelf']) {
      expect(await editOneOff(h.head, { ...shelf, taskId, version: 1 })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
  });
});

describe('removeOneOff (ADR-0006 §3, clarification)', () => {
  it('removes the member’s own one-off, and logs it by name', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    h.clock.advance({ minutes: 1 });
    expect(await removeOneOff(h.adult, { taskId, version: 1 })).toEqual({ ok: true });
    // Never planned, so nothing keeps it.
    expect(await stored(h, taskId)).toBeUndefined();
    expect(await logged(h)).toEqual([
      { actor: h.alex, action: 'one-off.added', task: 'Fix the shelf' },
      { actor: h.alex, action: 'one-off.removed', task: 'Fix the shelf' },
    ]);
    expect(await removeOneOff(h.adult, { taskId, version: 2 })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('takes a planned one-off out of this week’s plan (ADR-0001 §1, clarification)', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    await draftPlan(h.scheduler, { week: week1 });
    await publishPlan(h.scheduler, { week: week1 });
    expect(await removeOneOff(h.adult, { taskId, version: 1 })).toEqual({ ok: true });
    expect((await h.plan(week1))?.rows).toEqual([]);
    // Nobody did it, so nothing keeps it.
    expect(await stored(h, taskId)).toBeUndefined();
  });

  it('is for whoever added it until it is done, and for heads with two factors always', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    const robinAsAdult = { ...h.head, member: { ...h.head.member, role: 'adult' as const } };
    expect(await removeOneOff(robinAsAdult, { taskId, version: 1 })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    await done(h, taskId);
    expect(await removeOneOff(h.adult, { taskId, version: 1 })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    // Done, so its work stays in the plan.
    expect(await removeOneOff(h.head, { taskId, version: 1 })).toEqual({ ok: true });
    expect(await stored(h, taskId)).toMatchObject({ removed: true });
    expect((await h.plan(week1))?.rows.map((row) => row.status)).toEqual(['done']);
    expect((await logged(h)).at(-1)).toEqual({
      actor: h.robin,
      action: 'one-off.removed',
      task: 'Fix the shelf',
    });
  });

  it('removes nothing changed since the confirmation was loaded, and needs its version', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    await editOneOff(h.adult, { ...shelf, taskId, version: 1, name: 'Fix the shelves' });
    expect(await removeOneOff(h.adult, { taskId, version: 1 })).toMatchObject({
      ok: false,
      error: 'conflict',
      current: { name: 'Fix the shelves', version: 2 },
    });
    for (const version of [0, 1.5, '2', undefined]) {
      expect(await removeOneOff(h.adult, { taskId, version })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await stored(h, taskId)).toMatchObject({ removed: false });
  });
});

describe('one-offs in the activity log (ADR-0018 §5, clarification)', () => {
  it('shows every member who added or removed which one-off, by its name then', async () => {
    const h = await plannedHousehold(db);
    const taskId = await added(h.adult);
    await editOneOff(h.adult, { ...shelf, taskId, version: 1, name: 'Fix the shelves' });
    h.clock.advance({ minutes: 1 });
    await removeOneOff(h.head, { taskId, version: 2 });
    const shown = await householdActivity(h.adult);
    if (!shown.ok) throw new Error('Not shown');
    expect(
      shown.entries.map(({ actor, action, task, byReader }) => ({ actor, action, task, byReader })),
    ).toEqual([
      { actor: 'Robin', action: 'one-off.removed', task: 'Fix the shelves', byReader: false },
      { actor: 'Alex', action: 'one-off.added', task: 'Fix the shelf', byReader: true },
    ]);
  });
});
