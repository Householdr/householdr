import {
  draftPlan,
  publishPlan,
  queueDuePlanSteps,
  type Clock,
  type Database,
  type Flags,
  type JobQueue,
  type Jobs,
} from '@householdr/application';

/** What the plans' jobs need: the database, the time, and whether their flag is on (CODE-20). */
export interface PlansContext {
  db: Database;
  clock: Clock;
  flags: Flags;
}

/** Queues the plan steps that are due, every minute (ADR-0008 §10). */
export async function tickPlans(context: PlansContext & { queue: JobQueue }) {
  if (!context.flags.isOn('plans')) return;
  await queueDuePlanSteps(context);
}

// The steps act for the scheduler. Each changes nothing when it comes again, so whatever came of
// one, such as a week published already, there is nothing left for its job to do (CODE-19).

/** Drafts a household's plan for a week, once its draft time has come (ADR-0006 §2). */
export async function draftScheduledPlan(context: PlansContext, job: Jobs['plan-draft']) {
  if (!context.flags.isOn('plans')) return;
  await draftPlan(scheduler(context, job.household), { week: job.week });
}

/** Publishes a household's draft for a week, once its publish time has come (ADR-0006 §2). */
export async function publishScheduledPlan(context: PlansContext, job: Jobs['plan-publish']) {
  if (!context.flags.isOn('plans')) return;
  await publishPlan(scheduler(context, job.household), { week: job.week });
}

const scheduler = ({ db, clock }: PlansContext, householdId: string) => ({
  db,
  clock,
  householdId,
  member: 'scheduler' as const,
});
