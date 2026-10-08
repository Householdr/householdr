import { households, inHousehold, schedules, tasks } from '@householdr/db';
import { can, frequencyOf, startRange, type Frequency } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import type { HouseholdContext } from '../households/membership';
import { scheduleOf } from './stored-schedule';

/** A task of the household, as its list shows it (ADR-0001 §1). */
export interface TaskSummary {
  id: string;
  name: string;
  /** In minutes. */
  duration: number;
  frequency: Frequency;
}

type ListTasksResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      tasks: TaskSummary[];
      /** Whether the member may add tasks: a head with two factors (ADR-0001 §2). */
      mayAddTasks: boolean;
      /** The days a new task can start on, from today in the household's time zone. */
      starts: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate };
    }
  | { ok: false; error: 'not-allowed' };

/**
 * The household's tasks by name, each with its frequency, which every member sees (ADR-0012 §3),
 * and what adding one needs.
 */
export async function listTasks(context: HouseholdContext): Promise<ListTasksResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx
      .select({ name: households.name, timeZone: households.timeZone })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const rows = await tx
      .select({
        id: tasks.id,
        name: tasks.name,
        duration: tasks.duration,
        rules: schedules.rules,
        extraDates: schedules.extraDates,
        exceptionDates: schedules.exceptionDates,
      })
      .from(tasks)
      .innerJoin(schedules, eq(schedules.id, tasks.scheduleId));
    const list = rows.map(({ id, name, duration, ...schedule }): TaskSummary => {
      const frequency = frequencyOf(scheduleOf(schedule));
      // Only simple frequencies are written until the advanced editor comes (ADR-0004 §3).
      if (!frequency) throw new Error(`Task ${id} isn't on a simple frequency.`);
      return { id, name, duration, frequency };
    });
    list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    return {
      ok: true as const,
      household: household.name,
      tasks: list,
      mayAddTasks: can(context.member, { action: 'household.tasks' }),
      starts: startRange(today),
    };
  });
}
