import { awayPeriods, households, type Transaction } from '@householdr/db';
import {
  can,
  type HouseholdCalendar,
  type Member,
  type PlanTimings,
  type PlanWeek,
  type RebalancePreset,
} from '@householdr/domain';
import { and, gte, lt } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdsContext } from '../households/context';
import type { Clock } from '../ports';
import { calendarColumns, calendarOf } from '../shares/member-share';

/**
 * Who acts on a household's plans: a member of it, or the scheduler at the household's draft and
 * publish times (ADR-0006 §2, ADR-0023 §4).
 */
export interface PlanContext extends HouseholdsContext {
  clock: Clock;
  householdId: string;
  member: Member | 'scheduler';
}

/** A household as planning reads it (ADR-0001 §1). */
export interface Planning {
  calendar: HouseholdCalendar;
  timings: PlanTimings;
  /** The first day of its first plan week; none while it is in setup (ADR-0007 §2). */
  firstWeek: Temporal.PlainDate | undefined;
  /** Whether it started now, whose first draft waits for a head (ADR-0007 §3). */
  startedNow: boolean;
  rebalance: RebalancePreset;
}

/**
 * The household's planning settings. `lock` keeps anyone else from drafting or publishing its
 * plans until the transaction ends, so a scheduler and a head never do it at once.
 */
export async function planningOf(tx: Transaction, { lock = false } = {}): Promise<Planning> {
  const query = tx
    .select({
      ...calendarColumns,
      firstPlanWeek: households.firstPlanWeek,
      startedNow: households.startedNow,
      draftHours: households.draftHours,
      publishHours: households.publishHours,
      rebalance: households.rebalance,
    })
    .from(households);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new Error('The household is gone.');
  return {
    calendar: calendarOf(row),
    timings: { draft: row.draftHours, publish: row.publishHours },
    firstWeek: row.firstPlanWeek === null ? undefined : Temporal.PlainDate.from(row.firstPlanWeek),
    startedNow: row.startedNow,
    rebalance: row.rebalance,
  };
}

/** The household's periods away that touch `week` (ADR-0005 §5). */
export async function awayIn(tx: Transaction, week: PlanWeek) {
  const rows = await tx
    .select({ from: awayPeriods.firstDay, to: awayPeriods.lastDay })
    .from(awayPeriods)
    .where(
      and(
        gte(awayPeriods.lastDay, week.start.toString()),
        lt(awayPeriods.firstDay, week.end.toString()),
      ),
    );
  return rows.map((row) => ({
    from: Temporal.PlainDate.from(row.from),
    to: Temporal.PlainDate.from(row.to),
  }));
}

/** A day of the calendar as `YYYY-MM-DD`: one that exists, unlike 30 February. */
const day = v.pipe(
  v.string(),
  v.isoDate(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try {
      return Temporal.PlainDate.from(dataset.value, { overflow: 'reject' });
    } catch {
      addIssue();
      return NEVER;
    }
  }),
);

/** Which plan week (CODE-12): any of its days. */
export const weekInput = v.object({ week: day });

/**
 * Whether the context may draft and publish plans: the scheduler, or a head with two factors, who
 * sees and changes drafts and publishes early (ADR-0006 §2).
 */
export const mayDraft = (context: PlanContext) =>
  context.member === 'scheduler' || can(context.member, { action: 'plan.draft' });
