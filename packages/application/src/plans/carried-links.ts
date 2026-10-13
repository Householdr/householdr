import { assignments, occurrences, plans, type Transaction } from '@householdr/db';
import { linkedPairs, occurrenceId, type PlannedOccurrence } from '@householdr/domain';
import { and, eq, isNotNull } from 'drizzle-orm';

/**
 * Who this week's linked occurrences go to because of last week (ADR-0001 §7, clarification): when
 * an occurrence assigned in the plan before `weekStart` pairs, by `links`, with an occurrence of
 * `thisWeek`, that one goes to the same member. Member ids by occurrence id.
 */
export async function carriedLinks(
  tx: Transaction,
  weekStart: Temporal.PlainDate,
  timeZone: string,
  links: ReadonlyMap<string, string>,
  thisWeek: readonly PlannedOccurrence[],
): Promise<Map<string, string>> {
  if (links.size === 0) return new Map();
  const rows = await tx
    .select({
      taskId: occurrences.taskId,
      date: occurrences.date,
      windowStart: occurrences.windowStart,
      windowEnd: occurrences.windowEnd,
      memberId: assignments.memberId,
    })
    .from(assignments)
    .innerJoin(plans, eq(plans.id, assignments.planId))
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .where(and(eq(plans.weekEnd, weekStart.toString()), isNotNull(assignments.memberId)));
  const zoned = (at: Date) =>
    Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
  const ours = new Set(thisWeek.map(({ id }) => id));
  const members = new Map<string, string>();
  // An occurrence of last week still open is this week's too: it pairs as one of this week's.
  const lastWeek = rows.flatMap((row): PlannedOccurrence[] => {
    const id = occurrenceId(row.taskId, Temporal.PlainDate.from(row.date));
    if (ours.has(id) || row.memberId === null) return [];
    members.set(id, row.memberId);
    return [
      {
        id,
        task: row.taskId,
        date: Temporal.PlainDate.from(row.date),
        window: { start: zoned(row.windowStart), end: zoned(row.windowEnd) },
      },
    ];
  });
  const carried = new Map<string, string>();
  for (const [first, next] of linkedPairs([...lastWeek, ...thisWeek], links)) {
    const member = members.get(first.id);
    if (member !== undefined && ours.has(next.id)) carried.set(next.id, member);
  }
  return carried;
}
