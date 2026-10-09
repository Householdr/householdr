import {
  assignments,
  completionCredits,
  completions,
  inHousehold,
  ledgerEntries,
  plans,
} from '@householdr/db';
import {
  goneDays,
  householdDate,
  planWeek,
  settleWeek,
  weekHasBegun,
  type Points,
} from '@householdr/domain';
import { and, eq, lt, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as v from 'valibot';
import { fairPortions } from '../plans/fair-portions';
import { awayIn, planningOf, weekInput, type PlanContext } from '../plans/planning';

type SettlePlanWeekResult =
  /** The week is settled into every member's balance: now, or before, as settling again finds it. */
  | { ok: true; settled: true }
  /**
   * The week has no published plan, so there is nothing to settle: none was made, as for a week the
   * household is away for entirely (ADR-0005 §5), or its draft was never published.
   */
  | { ok: true; settled: false }
  /** Only the scheduler settles a week, once it is over (ADR-0002 §1). */
  | { ok: false; error: 'not-allowed' }
  /** Not a day. */
  | { ok: false; error: 'invalid' }
  /** The week isn't over: the next one hasn't begun in the household's time zone. */
  | { ok: false; error: 'not-over' };

/**
 * Settles the plan week of `week`, any of its days, once it is over (ADR-0002 §1, §7): every
 * member's balance changes by what they did that week less their fair portion of what its published
 * plan allocated, as a ledger entry each. What was allocated is what the plan gave to a member, at
 * the cost stored with it; an occurrence carried over into the week but done before it began, in an
 * earlier week's plan, is no work of this week (ADR-0002 §2, clarification). What a member did is
 * what the completions in this week's plan credit them, also for work picked up from someone else
 * or done together (§1, §4). Fair portions are as the week ended up: shares, temporary ones,
 * absences and the household's days away, over the days the plan was made for. Settling a week
 * twice changes nothing (CODE-19).
 */
export async function settlePlanWeek(
  context: PlanContext,
  input: unknown,
): Promise<SettlePlanWeekResult> {
  if (context.member !== 'scheduler') return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(weekInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<SettlePlanWeekResult> => {
    // Locked, as drafting locks it, so a week is settled by one at a time.
    const { calendar } = await planningOf(tx, { lock: true });
    const { start } = planWeek(parsed.output.week, calendar);
    const [plan] = await tx
      .select({
        id: plans.id,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
        status: plans.status,
        draftedAt: plans.draftedAt,
      })
      .from(plans)
      .where(eq(plans.weekStart, start.toString()));
    if (plan?.status !== 'published') return { ok: true, settled: false };
    const week = {
      start: Temporal.PlainDate.from(plan.weekStart),
      end: Temporal.PlainDate.from(plan.weekEnd),
    };
    const now = context.clock.now();
    if (!weekHasBegun(week.end, now, calendar.timeZone)) return { ok: false, error: 'not-over' };
    const [settled] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.kind, 'settlement'), eq(ledgerEntries.week, plan.weekStart)))
      .limit(1);
    if (settled) return { ok: true, settled: true };

    const doneIn = alias(plans, 'done_in');
    const given = await tx
      .select({ member: assignments.memberId, points: assignments.cost })
      .from(assignments)
      .where(
        and(
          eq(assignments.planId, plan.id),
          notExists(
            tx
              .select({ id: completions.id })
              .from(completions)
              .innerJoin(doneIn, eq(doneIn.id, completions.planId))
              .where(
                and(
                  eq(completions.occurrenceId, assignments.occurrenceId),
                  lt(doneIn.weekStart, plan.weekStart),
                ),
              ),
          ),
        ),
      );
    // What nobody could take charges nobody (ADR-0001 §7, clarification).
    const allocated = given.flatMap(({ member, points }): Points[] =>
      member === null || points === null ? [] : [{ member, points }],
    );
    const done = await tx
      .select({ member: completionCredits.memberId, points: completionCredits.points })
      .from(completionCredits)
      .innerJoin(completions, eq(completions.id, completionCredits.completionId))
      .where(eq(completions.planId, plan.id));

    // A plan drafted once its week had begun, as when a household starts now, is for the days
    // left: the days already gone count as days away, in its settlement as in its draft (ADR-0007
    // §3).
    const draftedOn = householdDate(
      Temporal.Instant.fromEpochMilliseconds(plan.draftedAt.getTime()),
      calendar.timeZone,
    );
    const away = [...(await awayIn(tx, week)), ...goneDays(week, draftedOn)];
    const portions = await fairPortions(tx, calendar, week, away);
    const settlement = settleWeek(
      new Map(portions.map(({ id, fairFraction }) => [id, fairFraction])),
      allocated,
      done,
    );
    const at = new Date(now.epochMilliseconds);
    // What each owed and did stays here: only the change is kept (ADR-0018 §4, ADR-0003 §5).
    await tx.insert(ledgerEntries).values(
      settlement.map(({ member, change }) => ({
        householdId,
        memberId: member,
        kind: 'settlement' as const,
        week: plan.weekStart,
        change,
        at,
      })),
    );
    return { ok: true, settled: true };
  });
}
