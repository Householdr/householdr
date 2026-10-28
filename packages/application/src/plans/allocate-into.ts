import { assignments, nextVersion, occurrences, plans, type Transaction } from '@householdr/db';
import {
  allocate,
  goneDays,
  householdDate,
  rebalanceRates,
  type PlannedOccurrence,
} from '@householdr/domain';
import { eq, sum } from 'drizzle-orm';
import { membersOf } from './allocation-members';
import { awayIn, type Planning } from './planning';

/** A plan of the household, as allocating into it needs it. */
interface Plan {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: 'draft' | 'published';
}

/**
 * Allocates `occurrence`, of the task `task`, into `plan` on its own, at `now` (ADR-0006 §3): the
 * normal allocator on that occurrence only, with the members' loads in the plan as its starting
 * point, so no assignment already made changes. The occurrence is stored with its own window,
 * which lies within the plan's week. A draft that changes moves on to a new version, so a head
 * publishes it as it is now (ADR-0019 §5).
 */
export async function allocateInto(
  tx: Transaction,
  {
    householdId,
    planning,
    plan,
    now,
  }: { householdId: string; planning: Planning; plan: Plan; now: Temporal.Instant },
  occurrence: PlannedOccurrence,
  task: { id: string; duration: number },
) {
  const { calendar } = planning;
  const week = {
    start: Temporal.PlainDate.from(plan.weekStart),
    end: Temporal.PlainDate.from(plan.weekEnd),
  };
  // Shares and availability count over the days at home still to come, as when drafting.
  const away = [
    ...(await awayIn(tx, week)),
    ...goneDays(week, householdDate(now, calendar.timeZone)),
  ];
  const people = await membersOf(tx, planning, week, away);
  const loads = new Map(
    (
      await tx
        .select({ member: assignments.memberId, points: sum(assignments.cost).mapWith(Number) })
        .from(assignments)
        .where(eq(assignments.planId, plan.id))
        .groupBy(assignments.memberId)
    ).map(({ member, points }) => [member, points]),
  );
  const allocation = allocate({
    week: week.start,
    calendar,
    rebalanceRate: rebalanceRates[planning.rebalance],
    members: people.map((member) => ({ ...member, load: loads.get(member.id) ?? 0 })),
    // Its burden is the prior, as a one-off is never compared (ADR-0003 §3a, clarification).
    tasks: [
      {
        ...task,
        burden: new Map(people.map((member) => [member.id, 1])),
        constraints: new Map(),
      },
    ],
    occurrences: [occurrence],
    preAssigned: new Map(),
    carried: new Map(),
  });
  const window = {
    windowStart: new Date(occurrence.window.start.epochMilliseconds),
    windowEnd: new Date(occurrence.window.end.epochMilliseconds),
  };
  const [stored] = await tx
    .insert(occurrences)
    .values({
      householdId: householdId,
      taskId: task.id,
      date: occurrence.date.toString(),
      ...window,
    })
    .returning({ id: occurrences.id });
  if (!stored) throw new Error('No occurrence was written.');
  const [assigned] = allocation.assignments;
  const [unassigned] = allocation.unassigned;
  await tx.insert(assignments).values({
    householdId: householdId,
    planId: plan.id,
    occurrenceId: stored.id,
    ...window,
    ...(assigned
      ? { memberId: assigned.member, cost: assigned.cost, reason: assigned.reason }
      : { unassignedCause: unassigned?.cause }),
  });
  if (plan.status === 'draft') {
    await tx
      .update(plans)
      .set({ version: nextVersion(plans) })
      .where(eq(plans.id, plan.id));
  }
}
