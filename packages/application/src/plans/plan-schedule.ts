import {
  inHousehold,
  plans,
  queueJob,
  startedHouseholds,
  type Database,
  type JobQueue,
} from '@householdr/db';
import { duePlanStep, nextPlanWeek } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import type { Clock } from '../ports';
import { awayIn, planningOf } from './planning';

/** What the scheduler needs: the database, the time, and the queue it puts the steps on. */
export interface ScheduleContext {
  db: Database;
  clock: Clock;
  queue: JobQueue;
}

/**
 * Queues the plan steps that are due now (ADR-0006 §2, ADR-0008 §10): for each household past
 * setup, drafting its next plan week once the draft time has come, and publishing that draft once
 * the publish time has come, in the household's own time zone and week. Each step is queued by its
 * household and week, so a tick that runs twice queues it once. Returns how many it queued.
 */
export async function queueDuePlanSteps(context: ScheduleContext): Promise<number> {
  const now = context.clock.now();
  let queued = 0;
  // Households in setup get no plan (ADR-0007 §2); each is read in its own transaction.
  for (const householdId of await startedHouseholds(context.db)) {
    await inHousehold(context.db, householdId, async (tx) => {
      const planning = await planningOf(tx);
      const week = nextPlanWeek(now, planning.calendar);
      const [plan] = await tx
        .select({ status: plans.status })
        .from(plans)
        .where(eq(plans.weekStart, week.start.toString()));
      const step = duePlanStep(now, week, plan?.status, {
        ...planning,
        away: await awayIn(tx, week),
      });
      if (!step) return;
      const job = { household: householdId, week: week.start.toString() };
      await queueJob(context.queue, tx, step === 'draft' ? 'plan-draft' : 'plan-publish', job);
      queued++;
    });
  }
  return queued;
}
