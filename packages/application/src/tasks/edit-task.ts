import { atVersion, households, inHousehold, nextVersion, schedules, tasks } from '@householdr/db';
import { can, defaultTiming, frequencyRule } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { storedRules } from './stored-schedule';
import { refusedFields, taskFields, taskReference, version, type TaskField } from './task-fields';
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
 * Changes a task's name, duration, frequency, first time or on-miss policy, by a head (ADR-0001
 * §2), from the version they saw (ADR-0019 §5). A new frequency or first time rewrites the single
 * rule of the task's own schedule (ADR-0004 §3), and the timing follows the frequency, as when it
 * was added (ADR-0004 §4). A task that has started keeps its first time, or moves to a day from
 * today on (`isStartDay`). Saved unchanged, the task keeps its version.
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
    const parsed = v.safeParse(v.object({ ...taskFields(today, current.start), version }), input);
    if (!parsed.success) {
      // A form loaded before someone else's change hears of that change first: what is refused
      // now, such as a first time the task no longer has, may be what the form was loaded with.
      const seen = v.safeParse(v.looseObject({ version }), input);
      if (seen.success && seen.output.version !== current.version) return conflict();
      return { ok: false, error: 'invalid', fields: refusedFields(parsed.issues) };
    }
    const { name, duration, frequency, start, onMiss } = parsed.output;
    const ruleChanged = frequency !== current.frequency || !start.equals(current.start);
    const changed =
      ruleChanged ||
      name !== current.name ||
      duration !== current.duration ||
      onMiss !== current.onMiss;
    // Nothing to write, so the task keeps its version, even when the form's is older: what it
    // sent is what the task is.
    if (!changed) return { ok: true };
    // Only while the task is still at the version the form was loaded with (ADR-0019 §5).
    const [updated] = await tx
      .update(tasks)
      .set({
        name,
        duration,
        timing: defaultTiming(frequency).kind,
        onMiss,
        version: nextVersion(tasks),
      })
      .where(atVersion(tasks, taskId, parsed.output.version))
      .returning({ id: tasks.id });
    if (!updated) return conflict();
    if (ruleChanged) {
      // The schedule is the task's own (ADR-0004 §3), and has its own version (ADR-0019 §5).
      const [rewritten] = await tx
        .update(schedules)
        .set({
          rules: storedRules([frequencyRule(frequency, start)]),
          version: nextVersion(schedules),
        })
        .where(atVersion(schedules, schedule.id, schedule.version))
        .returning({ id: schedules.id });
      // Only its task changes a task's own schedule, and this transaction holds the task's row.
      if (!rewritten) throw new Error(`The schedule of task ${taskId} changed while it was saved.`);
    }
    return { ok: true };
  });
}
