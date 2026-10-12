import { plans, shareChanges, type Transaction } from '@householdr/db';
import { householdDate, planWeek, type PlanWeek } from '@householdr/domain';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Planning } from '../plans/planning';

/**
 * The first plan week, from the one underway on, whose plan isn't published: the week a change to
 * a share applies from (ADR-0001 §4).
 */
async function nextUnpublishedWeek(
  tx: Transaction,
  planning: Planning,
  now: Temporal.Instant,
): Promise<PlanWeek> {
  const { calendar } = planning;
  let week = planWeek(householdDate(now, calendar.timeZone), calendar);
  for (;;) {
    const [published] = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.weekStart, week.start.toString()), eq(plans.status, 'published')));
    if (!published) return week;
    week = planWeek(week.end, calendar);
  }
}

/**
 * Keeps that member `memberId`'s share is `percent` (none for the default) from the next unpublished
 * plan on, once the household has started, so settling a week uses the share of that week (ADR-0002
 * §1, clarification). The first change also keeps `previous`, the share before it, from the
 * household's first plan week. Before the start no plan is affected, so nothing is kept.
 */
export async function keepShareChange(
  tx: Transaction,
  planning: Planning,
  now: Temporal.Instant,
  change: {
    householdId: string;
    memberId: string;
    previous: number | null;
    percent: number | null;
  },
) {
  const { firstWeek } = planning;
  if (!firstWeek) return;
  const { householdId, memberId, previous, percent } = change;
  const from = (await nextUnpublishedWeek(tx, planning, now)).start;
  const [kept] = await tx
    .select({ id: shareChanges.id })
    .from(shareChanges)
    .where(eq(shareChanges.memberId, memberId))
    .limit(1);
  if (!kept && Temporal.PlainDate.compare(firstWeek, from) < 0) {
    await tx
      .insert(shareChanges)
      .values({ householdId, memberId, fromWeek: firstWeek.toString(), percent: previous });
  }
  await tx
    .insert(shareChanges)
    .values({ householdId, memberId, fromWeek: from.toString(), percent })
    .onConflictDoUpdate({
      target: [shareChanges.householdId, shareChanges.memberId, shareChanges.fromWeek],
      set: { percent },
    });
}

/**
 * The share each member kept a change for had in plan week `week`, by member id: the last one from
 * that week or before (ADR-0002 §1, clarification). A member missing here has had the share set now
 * all along.
 */
export async function sharesInWeek(
  tx: Transaction,
  week: PlanWeek,
): Promise<Map<string, number | null>> {
  const rows = await tx
    .select({ memberId: shareChanges.memberId, percent: shareChanges.percent })
    .from(shareChanges)
    .where(lte(shareChanges.fromWeek, week.start.toString()))
    .orderBy(desc(shareChanges.fromWeek));
  const shares = new Map<string, number | null>();
  for (const row of rows) if (!shares.has(row.memberId)) shares.set(row.memberId, row.percent);
  return shares;
}
