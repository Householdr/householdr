import { editTask, taskToEdit, type EditableTask } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import {
  changedSchedule,
  scheduleData,
  scheduleFields,
  scheduleValues,
  sentSchedule,
} from '#lib/task-schedule.js';
import { rulesInput, rulesValues, sentRules } from '#lib/task-rules.js';
import { windowData, windowInput, windowValues } from '#lib/task-window.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The household's context for the member opening one of its tasks; the guard has checked that they
 * are one of its members (ADR-0017 §2). The page exists only while the tasks' release flag is on
 * (CODE-20).
 */
async function householdContext(locals: App.Locals) {
  if (!locals.flags.tasks || !locals.membership) error(404);
  const { db, clock } = await authContext();
  return { db, clock, ...locals.membership };
}

/**
 * A task as the page shows it, its first time as `YYYY-MM-DD`, and its interval, if it is counted
 * from when it was last done, its set times, if any, as its form's fields have them, and an
 * advanced schedule's days as `YYYY-MM-DD`.
 */
const shown = (task: EditableTask) => ({
  ...task,
  start: task.start.toString(),
  everyCount: task.every ? String(task.every.count) : '',
  everyUnit: task.every?.unit ?? 'weeks',
  window: task.window && windowData(task.window),
  schedule: task.schedule && scheduleData(task.schedule),
  sharedWith: task.sharedWith.map(({ name }) => name),
  // Its link is the form's to show, by the task's id.
  linkedTo: undefined,
  ...windowValues(task.window),
});

/** The task, for a head to change (ADR-0001 §2), from the version it is at now (ADR-0019 §5). */
export const load = (async ({ locals, params }) => {
  const result = await taskToEdit(await householdContext(locals), { taskId: params.task });
  if (!result.ok) error(result.error === 'not-found' ? 404 : 403);
  const { earliest, latest } = result.starts;
  const task = shown(result.task);
  const today = result.today.toString();
  return {
    household: result.household,
    // An advanced schedule's fields too, or one new rule for a task that turns to one.
    task: { ...task, ...scheduleValues(task.schedule, today) },
    starts: { earliest: earliest.toString(), latest: latest.toString() },
    dates: { earliest: result.dates.earliest.toString(), latest: result.dates.latest.toString() },
    today,
    shareable: result.shareable,
    members: result.members,
    linkable: result.linkable,
    // Who does it, as its form's fields have it (ADR-0001 §3).
    who: rulesValues(result.task),
  };
}) satisfies PageServerLoad;

/** The text of a form's field, or nothing. */
const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
};

export const actions = {
  // Saves the task from the version the form was loaded with (ADR-0019 §5). A button of the
  // advanced editor adds or removes one of its rows instead, and the form shows again with it
  // (CODE-10).
  save: async ({ locals, params, request }) => {
    const context = await householdContext(locals);
    const form = await request.formData();
    const values = {
      name: text(form, 'name'),
      duration: text(form, 'duration'),
      frequency: text(form, 'frequency'),
      everyCount: text(form, 'everyCount'),
      everyUnit: text(form, 'everyUnit'),
      start: text(form, 'start'),
      onMiss: text(form, 'onMiss'),
      when: text(form, 'when'),
      fromDay: text(form, 'fromDay'),
      fromTime: text(form, 'fromTime'),
      toDay: text(form, 'toDay'),
      toTime: text(form, 'toTime'),
      sharedWith: text(form, 'sharedWith'),
      ownDates: text(form, 'ownDates'),
      ...sentRules(form),
      version: Number(form.get('version')),
      ...sentSchedule(form),
    };
    const changed = changedSchedule(values, text(form, 'change'));
    if (changed) return { values: { ...values, ...changed } };
    const result = await editTask(context, {
      ...values,
      taskId: params.task,
      duration: Number(values.duration),
      // Only the fields that were sent: a form without scripts sends both kinds (ADR-0004 §8).
      everyCount: values.everyCount ? Number(values.everyCount) : undefined,
      everyUnit: values.everyUnit || undefined,
      onMiss: values.onMiss || undefined,
      // An advanced schedule's rules have first dates of their own (ADR-0004 §3).
      start: values.start || undefined,
      ...windowInput(values),
      ...scheduleFields(values),
      // Only when sharing: a form without scripts sends its first choice with any other.
      sharedWith: values.frequency === 'shared' ? values.sharedWith || undefined : undefined,
      ownDates: values.ownDates === 'on',
      ...rulesInput(values),
    });
    if (result.ok) return { saved: true };
    if (result.error === 'not-allowed') error(403);
    if (result.error === 'not-found') error(404);
    // What was typed stays in the form (UI-10).
    if (result.error === 'invalid') return fail(400, { values, invalid: result.fields });
    // Their input stays, at the current version, so saving again keeps it (ADR-0019 §5).
    return fail(409, {
      values: { ...values, version: result.current.version },
      conflict: { current: shown(result.current) },
    });
  },
} satisfies Actions;
