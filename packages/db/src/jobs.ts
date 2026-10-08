import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type Db } from 'pg-boss';
import type { Database, Transaction } from './connection';

/**
 * Every queue, with what its jobs carry: an ID, never personal data, which a job would otherwise
 * keep in the queue's archive (ADR-0014 §7, clarification).
 */
export interface Jobs {
  /** An account e-mail to send: the ID of its row in `auth.account_emails`. */
  'account-email': { id: string };
  /** Deletes the links to sign up that expired a week ago: carries nothing (ADR-0012 §5). */
  'expired-sign-up-links': Record<string, never>;
  /** Queues the plan steps that are due, household by household: carries nothing (ADR-0008 §10). */
  'plan-tick': Record<string, never>;
  /** Drafts a household's plan: its id, and the first day of the plan week (ADR-0006 §2). */
  'plan-draft': PlanJob;
  /** Publishes a household's draft: its id, and the first day of the plan week (ADR-0006 §2). */
  'plan-publish': PlanJob;
}

/** A step for one household's plan week: the household's id, and the week's first day. */
interface PlanJob {
  household: string;
  week: string;
}

export type QueueName = keyof Jobs;

const queues: Record<QueueName, Parameters<PgBoss['createQueue']>[1]> = {
  // A failed send is tried again after 1, 2, 4… minutes, at most ten times (ADR-0014 §7).
  'account-email': { retryLimit: 10, retryDelay: 60, retryBackoff: true },
  // A failed run waits for the next one.
  'expired-sign-up-links': { retryLimit: 0 },
  // One tick at a time; a failed one waits for the next.
  'plan-tick': { policy: 'exclusive', retryLimit: 0 },
  // One job for a household's week at a time, by its key (ADR-0008 §10); a failed one is queued
  // again by the next tick while it is still due.
  'plan-draft': { policy: 'exclusive', retryLimit: 0 },
  'plan-publish': { policy: 'exclusive', retryLimit: 0 },
};

/**
 * What a job of the queues with one is known by while it waits or runs, so it is never queued twice
 * (ADR-0008 §10): the household, the week and, by its queue, the step.
 */
const keys: { [Q in QueueName]?: (data: Jobs[Q]) => string } = {
  'plan-draft': ({ household, week }) => `${household}/${week}`,
  'plan-publish': ({ household, week }) => `${household}/${week}`,
};

/**
 * The queues that get a job on a schedule, in cron's terms and UTC: the deletion jobs (ADR-0012 §5)
 * and the plans' tick (ADR-0008 §10).
 */
const schedules: Partial<Record<QueueName, string>> = {
  // Every hour, off the full hour that other schedules crowd.
  'expired-sign-up-links': '23 * * * *',
  // Every minute, which is as late as a draft or a publish may come (ADR-0008 §10).
  'plan-tick': '* * * * *',
};

/** pg-boss's statements over `db`'s pool, as its own connections. */
function overPool(db: Database): Db {
  return { executeSql: (text, values) => db.$client.query(text, values) };
}

/**
 * The job queue over `db`, for the web app to queue jobs and for the worker to work them and send
 * the scheduled ones; `start` it before use. It never changes the schema: the migration step does
 * (ADR-0008 §10, clarification).
 */
export function jobQueue(db: Database, { worker = false } = {}) {
  return new PgBoss({ db: overPool(db), migrate: false, supervise: worker, schedule: worker });
}

/** The job queue, as `jobQueue` makes it. */
export type JobQueue = PgBoss;

/** Queues a job inside `tx`, the transaction of the change that causes it (ADR-0008 §10). */
export async function queueJob<Q extends QueueName>(
  queue: JobQueue,
  tx: Transaction,
  name: Q,
  data: Jobs[Q],
) {
  const key = keys[name]?.(data);
  // pg-boss's statements run in `tx`, so the job commits or rolls back with the change.
  await queue.send(name, data, {
    db: fromDrizzle(tx, sql),
    ...(key === undefined ? {} : { singletonKey: key }),
  });
}

/** Creates or upgrades pg-boss's tables, its queues and their schedules: part of the migration step. */
export async function migrateJobs(db: Database) {
  const boss = new PgBoss({ db: overPool(db), migrate: true, supervise: false, schedule: false });
  await boss.start();
  try {
    for (const [name, options] of Object.entries(queues)) await boss.createQueue(name, options);
    for (const [name, cron] of Object.entries(schedules)) await boss.schedule(name, cron);
  } finally {
    await boss.stop({ graceful: false });
  }
}
