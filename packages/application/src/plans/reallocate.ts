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
  isAvailableDuring,
  occurrenceId,
  planWeek,
  rebalanceRates,
  type AllocationTask,
  type PlannedOccurrence,
} from '@householdr/domain';
import { and, eq, sum } from 'drizzle-orm';
import { rulesByTask } from '../tasks/task-rules';
import { membersOf } from './allocation-members';
import { awayIn, type Planning } from './planning';

/**
 * Re-allocates what member `memberId` can no longer do in this week's published plan, once they
 * reported they can't (ADR-0005 §3, clarification): their open occurrences with no part of what is
 * left of their window when they are available. Each goes to a member available then, by the
 * allocator's usual rule on just those occurrences, counting what everyone has in the plan already
 * (ADR-0006 §3), with the reason "re-allocated: member unavailable". One nobody else can take
 * stays theirs and follows its on-miss policy. Nothing already moved comes back.
 */
export async function reallocateUnavailable(
  tx: Transaction,
  { planning, now }: { planning: Planning; now: Temporal.Instant },
  memberId: string,
) {
  const { calendar } = planning;
  const today = householdDate(now, calendar.timeZone);
  const week = planWeek(today, calendar);
  const [plan] = await tx
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.weekStart, week.start.toString()), eq(plans.status, 'published')));
  if (!plan) return;
  const rows = await tx
    .select({
      id: assignments.id,
      occurrence: occurrences.id,
      task: occurrences.taskId,
      date: occurrences.date,
      windowStart: assignments.windowStart,
      windowEnd: assignments.windowEnd,
      duration: tasks.duration,
    })
    .from(assignments)
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(
      and(
        eq(assignments.planId, plan.id),
        eq(assignments.memberId, memberId),
        eq(occurrences.status, 'open'),
      ),
    );
  // Availability over the days left, as when allocating into a published plan.
  const people = await membersOf(tx, planning, week, [
    ...(await awayIn(tx, week)),
    ...goneDays(week, today),
  ]);
  const member = people.find((person) => person.id === memberId);
  if (!member) return;
  const zoned = (at: Date) =>
    Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(calendar.timeZone);
  const nowZoned = now.toZonedDateTimeISO(calendar.timeZone);
  // What is left of each window, from now on.
  const left = rows.flatMap((row) => {
    const start = zoned(row.windowStart);
    const end = zoned(row.windowEnd);
    if (Temporal.ZonedDateTime.compare(end, nowZoned) <= 0) return [];
    const from = Temporal.ZonedDateTime.compare(start, nowZoned) < 0 ? nowZoned : start;
    return [{ row, window: { start: from, end } }];
  });
  const moving = left.filter(
    ({ window }) => !isAvailableDuring(member.availability, window, calendar),
  );
  if (moving.length === 0) return;
  const occurrencesToMove: PlannedOccurrence[] = moving.map(({ row, window }) => ({
    id: occurrenceId(row.task, Temporal.PlainDate.from(row.date)),
    task: row.task,
    date: Temporal.PlainDate.from(row.date),
    window,
  }));
  const loads = new Map(
    (
      await tx
        .select({ member: assignments.memberId, points: sum(assignments.cost).mapWith(Number) })
        .from(assignments)
        .where(eq(assignments.planId, plan.id))
        .groupBy(assignments.memberId)
    ).map(({ member: id, points }) => [id, points]),
  );
  const rules = await rulesByTask(tx);
  const durations = new Map(moving.map(({ row }) => [row.task, row.duration]));
  const allocation = allocate({
    week: week.start,
    calendar,
    rebalanceRate: rebalanceRates[planning.rebalance],
    members: people.map((person) => ({ ...person, load: loads.get(person.id) ?? 0 })),
    // Their burden is the prior until the comparison game brings evidence (ADR-0003 §2).
    tasks: Array.from(durations, ([id, duration]): AllocationTask => ({
      id,
      duration,
      burden: new Map(people.map((person) => [person.id, 1])),
      constraints: rules.get(id)?.constraints ?? new Map(),
    })),
    occurrences: occurrencesToMove,
    preAssigned: new Map(),
    carried: new Map(),
  });
  const byOccurrence = new Map(
    moving.map(({ row }) => [occurrenceId(row.task, Temporal.PlainDate.from(row.date)), row]),
  );
  for (const given of allocation.assignments) {
    const row = byOccurrence.get(given.occurrence);
    if (!row || given.member === memberId) continue;
    await tx
      .update(assignments)
      .set({
        memberId: given.member,
        cost: given.cost,
        reason: 're-allocated: member unavailable',
        version: nextVersion(assignments),
      })
      .where(eq(assignments.id, row.id));
  }
}
