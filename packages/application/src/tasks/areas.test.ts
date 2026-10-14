import { type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { addTask } from './add-task';
import { addArea, listAreas, removeArea, renameArea } from './areas';
import { editTask } from './edit-task';
import { listTasks } from './list-tasks';
import { taskToEdit } from './task-to-edit';

// A household's areas (ADR-0001 §1 with its clarification): added, renamed and removed by heads,
// seen by every member, and given to tasks, on a real database (TEST-11). Invented data (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

/** The id of area `name` of the household, as an adult sees it. */
const areaId = async (h: PlannedHousehold, name: string) => {
  const result = await listAreas(h.adult);
  const area = result.ok ? result.areas.find((a) => a.name === name) : undefined;
  if (!area) throw new Error(`No area ${name}`);
  return area.id;
};

describe('areas (ADR-0001 §1, clarification)', () => {
  it('are added by heads and seen by every member, by name', async () => {
    const h = await plannedHousehold(db);
    expect(await addArea(h.head, { name: ' Kitchen ' })).toEqual({ ok: true, name: 'Kitchen' });
    expect(await addArea(h.head, { name: 'Bathroom' })).toEqual({ ok: true, name: 'Bathroom' });
    expect(await listAreas(h.adult)).toMatchObject({
      ok: true,
      household: 'Ash Lane',
      areas: [{ name: 'Bathroom' }, { name: 'Kitchen' }],
      mayChange: false,
    });
    expect(await listAreas(h.head)).toMatchObject({ mayChange: true });
    expect(await addArea(h.adult, { name: 'Garden' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('refuse a name that is empty, too long, or another area’s whatever the case', async () => {
    const h = await plannedHousehold(db);
    await addArea(h.head, { name: 'Kitchen' });
    expect(await addArea(h.head, { name: '  ' })).toEqual({ ok: false, error: 'invalid' });
    expect(await addArea(h.head, { name: 'x'.repeat(51) })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await addArea(h.head, { name: 'KITCHEN' })).toEqual({ ok: false, error: 'taken' });
    await addArea(h.head, { name: 'Garden' });
    const garden = await areaId(h, 'Garden');
    expect(await renameArea(h.head, { areaId: garden, name: 'kitchen' })).toEqual({
      ok: false,
      error: 'taken',
    });
    // Its own name, in another case, is fine.
    expect(await renameArea(h.head, { areaId: garden, name: 'GARDEN' })).toEqual({
      ok: true,
      name: 'GARDEN',
    });
  });

  it('group the tasks given one, and leave them without one once removed', async () => {
    const h = await plannedHousehold(db);
    await addArea(h.head, { name: 'Kitchen' });
    const kitchen = await areaId(h, 'Kitchen');
    const dishes = {
      name: 'Do the dishes',
      duration: 20,
      frequency: 'daily',
      start: '2026-10-12',
      onMiss: 'roll over',
    };
    const added = await addTask(h.head, { ...dishes, areaId: kitchen });
    if (!added.ok) throw new Error('Not added');
    expect(await listTasks(h.adult)).toMatchObject({
      areas: [{ id: kitchen, name: 'Kitchen' }],
      tasks: [{ name: 'Do the dishes', areaId: kitchen }],
    });
    expect(await taskToEdit(h.head, { taskId: added.taskId })).toMatchObject({
      task: { areaId: kitchen },
      areas: [{ id: kitchen, name: 'Kitchen' }],
    });
    expect(await removeArea(h.head, { areaId: kitchen })).toEqual({ ok: true, name: 'Kitchen' });
    const result = await taskToEdit(h.head, { taskId: added.taskId });
    expect(result.ok && result.task.areaId).toBeUndefined();
    expect(await removeArea(h.head, { areaId: kitchen })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('are changed on a task, and refused if not the household’s', async () => {
    const h = await plannedHousehold(db);
    const other = await plannedHousehold(db);
    await addArea(other.head, { name: 'Garden' });
    const theirs = await areaId(other, 'Garden');
    const taskId = await h.task('Mow the lawn', 40, 'weekly', '2026-10-12');
    const mow = {
      taskId,
      version: 1,
      name: 'Mow the lawn',
      duration: 40,
      frequency: 'weekly',
      start: '2026-10-12',
      onMiss: 'roll over',
    };
    expect(await editTask(h.head, { ...mow, areaId: theirs })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['area'],
    });
    await addArea(h.head, { name: 'Garden' });
    const garden = await areaId(h, 'Garden');
    expect(await editTask(h.head, { ...mow, areaId: garden })).toEqual({ ok: true });
    expect(await taskToEdit(h.head, { taskId })).toMatchObject({
      task: { areaId: garden, version: 2 },
    });
  });
});
