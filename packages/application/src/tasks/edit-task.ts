import { atVersion, households, inHousehold, nextVersion, schedules, tasks } from '@householdr/db';
import { can, scheduleOfAdvanced, type WindowEdge } from '@householdr/domain';
import { and, eq, notExists } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { storedSchedule } from './stored-schedule';
import { written } from './stored-task';
import {
  advanced,
  refusedFields,
  sinceLastDone,
  taskInput,
  taskReference,
  version,
  type TaskField,
} from './task-fields';
import { readTask, type EditableTask } from './task-to-edit';

type EditTaskResult =
  | { ok: true }
  /** Only heads change tasks, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such task, or no longer. */
  | { ok: false; error: 'not-found' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: TaskField[] }
  /** Someone changed it since the form was loaded, so nothing was saved: the task now (ADR-0019 §5). */
  | { ok: false; error: 'conflict'; current: EditableTask };

/**
 * Changes a task's name, duration, how often it is done, first time or on-miss policy, by a head
 * (ADR-0001 §2), from the version they saw (ADR-0019 §5). On a simple frequency, a new frequency or
 * first time rewrites the single rule of the task's own schedule (ADR-0004 §3), and the timing
 * follows the frequency, as when it was added (§4). Counted from when it was last done instead, it
 * has no schedule: its own goes, and comes back new if it returns to a frequency (§8). A task that
 * has started keeps its first time, or moves to a day from today on (`isStartDay`). On an advanced
 * schedule, its rules and dates replace those of its own schedule, keeping the first times and
 * dates it had (§3, clarification). On a schedule, it is done any time that week or at set times
 * (§4, clarification). Saved unchanged, the task
 * keeps its version.
 */
export async function editTask(context: HouseholdContext, input: unknown): Promise<EditTaskResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const target = v.safeParse(taskReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const { taskId } = target.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<EditTaskResult> => {
    const conflict = async (): Promise<EditTaskResult> => {
      const now = await readTask(tx, taskId);
      return now
        ? { ok: false, error: 'conflict', current: now.task }
        : { ok: false, error: 'not-found' };
    };
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const found = await readTask(tx, taskId);
    if (!found) return { ok: false, error: 'not-found' };
    const { task: current, schedule } = found;
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    const kept = {
      start: current.start,
      ...(current.schedule && { schedule: scheduleOfAdvanced(current.schedule) }),
    };
    const parsed = v.safeParse(taskInput(today, kept), input);
    const seen = v.safeParse(v.looseObject({ version }), input);
    if (!parsed.success || !seen.success) {
      // A form loaded before someone else's change hears of that change first: what is refused
      // now, such as a first time the task no longer has, may be what the form was loaded with.
      if (seen.success && seen.output.version !== current.version) return conflict();
      return {
        ok: false,
        error: 'invalid',
        fields: parsed.success ? [] : refusedFields(parsed.issues),
      };
    }
    const next = parsed.output;
    const { schedule: dates, columns } = written(next);
    const sameRepeat =
      next.frequency === current.frequency &&
      (next.frequency === advanced
        ? current.schedule !== undefined &&
          isDeepStrictEqual(
            storedSchedule(scheduleOfAdvanced(next.schedule)),
            storedSchedule(scheduleOfAdvanced(current.schedule)),
          )
        : next.start.equals(current.start) &&
          (next.frequency !== sinceLastDone ||
            (next.everyCount === current.every?.count && next.everyUnit === current.every.unit)));
    const nextWindow = next.frequency === sinceLastDone ? undefined : next.window;
    const sameWindow =
      nextWindow === undefined || current.window === undefined
        ? nextWindow === current.window
        : sameEdge(nextWindow.from, current.window.from) &&
          sameEdge(nextWindow.to, current.window.to);
    const changed =
      !sameRepeat ||
      !sameWindow ||
      next.name !== current.name ||
      next.duration !== current.duration ||
      columns.onMiss !== current.onMiss;
    // Nothing to write, so the task keeps its version, even when the form's is older: what it
    // sent is what the task is.
    if (!changed) return { ok: true };
    // Only while the task is still at the version the form was loaded with (ADR-0019 §5), which
    // also holds its row until the transaction ends.
    const [claimed] = await tx
      .update(tasks)
      .set({ version: nextVersion(tasks) })
      .where(atVersion(tasks, taskId, seen.output.version))
      .returning({ id: tasks.id });
    if (!claimed) return conflict();
    let scheduleId = schedule?.id ?? null;
    if (dates && schedule && !sameRepeat) {
      // The schedule is the task's own (ADR-0004 §3), and has its own version (ADR-0019 §5).
      const [rewritten] = await tx
        .update(schedules)
        .set({ ...storedSchedule(dates), version: nextVersion(schedules) })
        .where(atVersion(schedules, schedule.id, schedule.version))
        .returning({ id: schedules.id });
      // Only its task changes a task's own schedule, and this transaction holds the task's row.
      if (!rewritten) throw new Error(`The schedule of task ${taskId} changed while it was saved.`);
    } else if (dates && !schedule) {
      const [added] = await tx
        .insert(schedules)
        .values({ householdId: context.householdId, ...storedSchedule(dates) })
        .returning({ id: schedules.id });
      if (!added) throw new Error('No schedule was written.');
      scheduleId = added.id;
    } else if (!dates) {
      scheduleId = null;
    }
    await tx
      .update(tasks)
      .set({ name: next.name, duration: next.duration, scheduleId, ...columns })
      .where(eq(tasks.id, taskId));
    if (!dates && schedule) {
      // Its own schedule goes with it, unless another task uses it too (ADR-0004 §1).
      await tx
        .delete(schedules)
        .where(
          and(
            eq(schedules.id, schedule.id),
            notExists(
              tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.scheduleId, schedule.id)),
            ),
          ),
        );
    }
    return { ok: true };
  });
}

/** Whether two edges of a fixed window are the same day and time (ADR-0004 §4). */
const sameEdge = (a: WindowEdge, b: WindowEdge) =>
  a.dayOffset === b.dayOffset && a.time.equals(b.time);
