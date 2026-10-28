import { comparisons, schedules, tasks, type Transaction } from '@householdr/db';
import {
  estimateBurdens,
  intervalTimesPerYear,
  timesPerYear,
  type BurdenEstimate,
  type Evidence,
} from '@householdr/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { scheduleOf } from '../tasks/stored-schedule';

/**
 * The household's tasks as burden estimates see them (ADR-0003 §1–§2): every recurring task still
 * in it, by name, starting at 1.0 until the template catalogue brings seeds (§2, clarification),
 * weighted by how often it occurs in the next 12 months from `today` (ADR-0004 §7). One-off tasks
 * come and go and aren't compared, so their burden stays the prior (ADR-0003 §3a, clarification).
 */
export async function burdenTasks(tx: Transaction, today: Temporal.PlainDate) {
  const rows = await tx
    .select({
      id: tasks.id,
      name: tasks.name,
      everyCount: tasks.everyCount,
      everyUnit: tasks.everyUnit,
      rules: schedules.rules,
      extraDates: schedules.extraDates,
      exceptionDates: schedules.exceptionDates,
    })
    .from(tasks)
    .leftJoin(schedules, eq(schedules.id, tasks.scheduleId))
    .where(and(isNull(tasks.once), eq(tasks.removed, false)));
  // How often a task comes round in a year: by its schedule, or 365 / N for a "since last done"
  // task (ADR-0004 §7–§8).
  const weightOf = ({ id, everyCount, everyUnit, ...schedule }: (typeof rows)[number]) => {
    const { rules, extraDates, exceptionDates } = schedule;
    if (rules && extraDates && exceptionDates) {
      return timesPerYear(scheduleOf({ rules, extraDates, exceptionDates }), today);
    }
    if (everyCount === null || everyUnit === null) {
      throw new Error(`Task ${id} has neither a schedule nor an interval.`);
    }
    return intervalTimesPerYear({ count: everyCount, unit: everyUnit });
  };
  return rows.map((row) => ({ id: row.id, name: row.name, prior: 1, weight: weightOf(row) }));
}

/**
 * Member `memberId`'s burden estimates over `list`, from their own answers only (ADR-0003 §5), and
 * how many answers they come from.
 */
export async function memberBurdens(
  tx: Transaction,
  memberId: string,
  list: Awaited<ReturnType<typeof burdenTasks>>,
): Promise<{ estimates: Map<string, BurdenEstimate>; answered: number }> {
  const answers = await tx
    .select({ harder: comparisons.harderTaskId, easier: comparisons.easierTaskId })
    .from(comparisons)
    .where(eq(comparisons.memberId, memberId));
  const estimates = estimateBurdens(
    list,
    answers.map(({ harder, easier }): Evidence => ({ kind: 'comparison', harder, easier })),
  );
  return { estimates, answered: answers.length };
}

/**
 * Every member's burden factor on every task, as of `today` (ADR-0003 §1, §4): a fit of each
 * member's own evidence, which plans and credits charge points by (ADR-0001 §5). A task without an
 * estimate, such as a one-off, and a member without one, are at the prior, 1.0. It only ever leaves
 * the server as the member's own points (ADR-0003 §5).
 */
export async function householdBurdens(
  tx: Transaction,
  today: Temporal.PlainDate,
): Promise<(task: string, member: string) => number> {
  const list = await burdenTasks(tx, today);
  const answers = await tx
    .select({
      member: comparisons.memberId,
      harder: comparisons.harderTaskId,
      easier: comparisons.easierTaskId,
    })
    .from(comparisons);
  const byMember = Map.groupBy(answers, (answer) => answer.member);
  const fits = new Map(
    Array.from(byMember, ([member, own]) => [
      member,
      estimateBurdens(
        list,
        own.map(({ harder, easier }): Evidence => ({ kind: 'comparison', harder, easier })),
      ),
    ]),
  );
  return (task, member) => fits.get(member)?.get(task)?.burden ?? 1;
}
