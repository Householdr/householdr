import { assignments, occurrences, plans, type Transaction } from '@householdr/db';
import { planWeek, type Absence, type AllocationMember, type PlanWeek } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import { balancesOf } from '../ledger/balances';
import { fairPortions } from './fair-portions';
import type { Planning } from './planning';

// The members as the allocator sees them, for drafting a week and for allocating into a plan.

/**
 * The members as the allocator sees them (ADR-0001 §6–§7): their fair portion of the week, over
 * the days the household is at home (ADR-0005 §5); a child's birth date; their balance, which the
 * plan catches up on (ADR-0002 §3), as settled up to the week before last; and the tasks they had in
 * last week's plan.
 */
export async function membersOf(
  tx: Transaction,
  planning: Planning,
  week: PlanWeek,
  away: readonly Absence[],
): Promise<AllocationMember[]> {
  const portions = await fairPortions(tx, planning.calendar, week, away);
  // Up to the week before last: the week before this one is underway as it is drafted, and its work
  // counts from the draft after (ADR-0002 §3, clarification).
  const lastWeekStart = planWeek(week.start.subtract({ days: 1 }), planning.calendar).start;
  const balances = await balancesOf(tx, { before: lastWeekStart });
  const lastWeek = await tx
    .select({ memberId: assignments.memberId, taskId: occurrences.taskId })
    .from(assignments)
    .innerJoin(plans, eq(plans.id, assignments.planId))
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .where(eq(plans.weekEnd, week.start.toString()));
  return portions.map(({ id, birthDate, availability, fairFraction }) => ({
    id,
    fairFraction,
    availability,
    ...(birthDate === undefined ? {} : { birthDate }),
    balance: balances.get(id) ?? 0,
    load: 0,
    lastWeek: new Set(lastWeek.filter((a) => a.memberId === id).map((a) => a.taskId)),
  }));
}
