import { completionCredits, members, type Transaction } from '@householdr/db';
import { householdDate, planWeek } from '@householdr/domain';
import { asc, eq } from 'drizzle-orm';
import { planningOf } from '../plans/planning';

// What completing and undoing both read.

/**
 * The household's date at `now`, and the plan week it is in: the week whose published plan
 * occurrences are done from, and within which a completion is undone (ADR-0006 §4).
 */
export async function thisPlanWeek(tx: Transaction, now: Temporal.Instant) {
  const { calendar } = await planningOf(tx);
  const today = householdDate(now, calendar.timeZone);
  return { today, ...planWeek(today, calendar) };
}

/**
 * Whether `today` is in the plan week of a stored plan, from `weekStart` up to `weekEnd`, as
 * `YYYY-MM-DD`: a completion done in it is undone within it (ADR-0006 §4).
 */
export function inPlanWeek(
  plan: { weekStart: string; weekEnd: string },
  today: Temporal.PlainDate,
) {
  return (
    Temporal.PlainDate.compare(Temporal.PlainDate.from(plan.weekStart), today) <= 0 &&
    Temporal.PlainDate.compare(today, Temporal.PlainDate.from(plan.weekEnd)) < 0
  );
}

/** The members completion `completionId` credits, by name. */
export function creditedMembers(tx: Transaction, completionId: string) {
  return tx
    .select({ id: members.id, name: members.name })
    .from(completionCredits)
    .innerJoin(members, eq(members.id, completionCredits.memberId))
    .where(eq(completionCredits.completionId, completionId))
    .orderBy(asc(members.name), asc(members.id));
}
