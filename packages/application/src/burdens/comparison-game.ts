import { comparisons, households, inHousehold, schedules, tasks } from '@householdr/db';
import {
  can,
  estimateBurdens,
  inRandomOrder,
  nextPair,
  timesPerYear,
  type Evidence,
} from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import type { Random } from '../ports';
import { scheduleOf } from '../tasks/stored-schedule';

/** A task of the household, as the comparison game names it. */
export interface ComparedTask {
  id: string;
  name: string;
}

/** What the game needs besides the household: draws for the order a pair is shown in. */
interface ComparisonGameContext extends HouseholdContext {
  random: Random;
}

/** How many pairs the member skipped in a row, none unless said (CODE-12). */
const fields = v.object({
  skipped: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0)), 0),
});

type ComparisonGameResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      /**
       * The two tasks to ask about next, in the order to show them, or null while the household
       * has fewer than two.
       */
      pair: readonly [ComparedTask, ComparedTask] | null;
      skipped: number;
      /** Whether the member has answered anything yet. */
      answered: boolean;
      /**
       * Every task of the household, from the hardest for them to the easiest: their burdens as an
       * order, without figures (ADR-0003 §5, clarification).
       */
      hardestFirst: ComparedTask[];
    }
  /** Only a member with an account plays, for themselves (ADR-0003 §5, ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'invalid' };

/**
 * What the comparison game shows the member playing it (ADR-0003 §3a, §5): the pair whose answer
 * tells the most about them, after the pairs they skipped, shown in a random order (§3a,
 * clarification), and their own burdens as an order, hardest first and without figures, so they
 * see what their answers change as tasks moving in it (§5, clarification; Consequences). Both come
 * from a fit of their own answers and of nobody else's. Every task is a custom one until the
 * template catalogue comes, so each starts at 1.0 (§2, clarification), weighted by how often it
 * occurs in the next 12 months from today in the household's time zone (ADR-0004 §7), as the
 * allocator will weigh it.
 */
export async function comparisonGame(
  context: ComparisonGameContext,
  input: unknown,
): Promise<ComparisonGameResult> {
  const self = context.member;
  if (
    !can(self, { action: 'comparison.play', member: self }) ||
    !can(self, { action: 'burdens.view', member: self })
  ) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(fields, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { skipped } = parsed.output;
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx
      .select({ name: households.name, timeZone: households.timeZone })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = context.clock.now().toZonedDateTimeISO(household.timeZone).toPlainDate();
    const rows = await tx
      .select({
        id: tasks.id,
        name: tasks.name,
        rules: schedules.rules,
        extraDates: schedules.extraDates,
        exceptionDates: schedules.exceptionDates,
      })
      .from(tasks)
      .innerJoin(schedules, eq(schedules.id, tasks.scheduleId));
    // Row-level security keeps other households out, but not the other members: the member's own
    // answers only (ADR-0003 §5, ADR-0018 §4).
    const answers = await tx
      .select({ harder: comparisons.harderTaskId, easier: comparisons.easierTaskId })
      .from(comparisons)
      .where(eq(comparisons.memberId, self.id));
    const estimates = estimateBurdens(
      rows.map(({ id, ...schedule }) => ({
        id,
        prior: 1,
        weight: timesPerYear(scheduleOf(schedule), today),
      })),
      answers.map(({ harder, easier }): Evidence => ({ kind: 'comparison', harder, easier })),
    );
    const named = new Map(rows.map(({ id, name }) => [id, { id, name }]));
    const ids = nextPair(estimates, skipped);
    const shown = ids && inRandomOrder(ids, context.random.next());
    const first = shown && named.get(shown[0]);
    const second = shown && named.get(shown[1]);
    // Only the order leaves here, not the burdens themselves (§5, clarification).
    const burdenOf = (id: string) => estimates.get(id)?.burden ?? 1;
    const hardestFirst = rows
      .map(({ id, name }) => ({ id, name }))
      .sort(
        (a, b) =>
          burdenOf(b.id) - burdenOf(a.id) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
    return {
      ok: true as const,
      household: household.name,
      pair: first && second ? ([first, second] as const) : null,
      skipped,
      answered: answers.length > 0,
      hardestFirst,
    };
  });
}
