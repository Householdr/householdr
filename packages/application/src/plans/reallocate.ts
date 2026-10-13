import {
  assignments,
  nextVersion,
  occurrences,
  plans,
  tasks,
  type Transaction,
} from '@householdr/db';
import {
  allocate,
  goneDays,
  householdDate,
  occurrenceId,
  planWeek,
  rebalanceRates,
  windowToReallocate,
  type Absence,
  type AllocationMember,
  type AllocationTask,
  type PlannedOccurrence,
  type PlanWeek,
} from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import { balancesOf } from '../ledger/balances';
import { fairPortions } from './fair-portions';
import { awayIn, type Planning } from './planning';

// Re-allocation after publishing (ADR-0006 §3): the normal allocator on some occurrences of a
// published plan only, with the week's current loads as its starting point.

/**
 * Re-allocates member `memberId`'s open occurrences in this plan week's published plan that they
 * can no longer do at `now`, once their "I can't today" is stored (ADR-0005 §3, with its
 * clarification): those with no part of what is left of their window in which they are available.
 * Each goes to one of the others available during what is left of it, by the allocator's usual
 * rule, counting what everyone has in the plan already, with the reason "re-allocated: member
 * unavailable" (ADR-0001 §7). Those nobody else can do stay theirs and follow their on-miss policy,
 * as does one whose window has passed. Nothing else in the plan changes: it stays frozen.
 */
export async function reallocateUnavailable(
  tx: Transaction,
  { planning, now }: { planning: Planning; now: Temporal.Instant },
  memberId: string,
) {
  const { calendar } = planning;
  const { timeZone } = calendar;
  const week = planWeek(householdDate(now, timeZone), calendar);
  const [plan] = await tx
    .select({ id: plans.id, draftedAt: plans.draftedAt })
    .from(plans)
    .where(and(eq(plans.weekStart, week.start.toString()), eq(plans.status, 'published')));
  if (!plan) return;
  const rows = await tx
    .select({
      id: assignments.id,
      memberId: assignments.memberId,
      cost: assignments.cost,
      windowStart: assignments.windowStart,
      windowEnd: assignments.windowEnd,
      taskId: occurrences.taskId,
      date: occurrences.date,
      status: occurrences.status,
      duration: tasks.duration,
    })
    .from(assignments)
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(eq(assignments.planId, plan.id));

  // The members as the plan was made for, from its draft (ADR-0002 §1, clarification), with what
  // came up since, this "I can't today" included.
  const draftedOn = householdDate(
    Temporal.Instant.fromEpochMilliseconds(plan.draftedAt.getTime()),
    timeZone,
  );
  const away = [...(await awayIn(tx, week)), ...goneDays(week, draftedOn)];
  const people = await membersOf(tx, planning, week, away, plan.draftedAt);
  const theirs = people.find((member) => member.id === memberId);
  if (!theirs) return;

  const zoned = (at: Date) =>
    Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
  const affected = rows.flatMap((row) => {
    if (row.memberId !== memberId || row.status !== 'open') return [];
    const window = { start: zoned(row.windowStart), end: zoned(row.windowEnd) };
    const left = windowToReallocate(theirs.availability, window, now, calendar);
    if (!left) return [];
    const date = Temporal.PlainDate.from(row.date);
    const occurrence: PlannedOccurrence = {
      id: occurrenceId(row.taskId, date),
      task: row.taskId,
      date,
      window: left,
    };
    return [{ row, occurrence }];
  });
  if (affected.length === 0) return;

  const loads = new Map<string, number>();
  for (const row of rows) {
    if (row.memberId !== null && row.cost !== null) {
      loads.set(row.memberId, (loads.get(row.memberId) ?? 0) + row.cost);
    }
  }
  const others = people
    .filter((member) => member.id !== memberId)
    .map((member) => ({ ...member, load: loads.get(member.id) ?? 0 }));
  const durations = new Map(affected.map(({ row }) => [row.taskId, row.duration]));
  const allocation = allocate({
    week: week.start,
    calendar,
    rebalanceRate: rebalanceRates[planning.rebalance],
    members: others,
    // As when drafting: every burden is the prior, 1.0, until the comparison game brings evidence
    // (ADR-0003 §2, clarification).
    tasks: Array.from(durations, ([id, duration]): AllocationTask => ({
      id,
      duration,
      burden: new Map(others.map((member) => [member.id, 1])),
      constraints: new Map(),
    })),
    occurrences: affected.map(({ occurrence }) => occurrence),
    preAssigned: new Map(),
    carried: new Map(),
  });
  const rowOf = new Map(affected.map(({ row, occurrence }) => [occurrence.id, row.id]));
  for (const given of allocation.assignments) {
    const id = rowOf.get(given.occurrence);
    if (id === undefined) throw new Error(`No assignment of ${given.occurrence}.`);
    await tx
      .update(assignments)
      .set({
        memberId: given.member,
        cost: given.cost,
        reason: 're-allocated: member unavailable',
        version: nextVersion(assignments),
      })
      .where(eq(assignments.id, id));
  }
}

/**
 * The members as the allocator sees them in plan week `week`, as drafting does (ADR-0001 §6–§7):
 * their fair portion as it now stands, which one who joined after the plan was drafted at
 * `draftedAt` has none of (ADR-0002 §1, clarification); a child's birth date; their balance as the
 * draft caught up on it, settled up to the week before last (ADR-0002 §3, clarification); and the
 * tasks they had in last week's plan. Their loads are the caller's.
 */
async function membersOf(
  tx: Transaction,
  planning: Planning,
  week: PlanWeek,
  away: readonly Absence[],
  draftedAt: Date,
): Promise<AllocationMember[]> {
  const portions = await fairPortions(tx, planning.calendar, week, away, { draftedAt });
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
