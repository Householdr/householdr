import { comparisons, inHousehold, tasks } from '@householdr/db';
import { can } from '@householdr/domain';
import { inArray } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';

const taskId = v.pipe(v.string(), v.uuid(), v.toLowerCase());

/**
 * What an answer sends (CODE-12): the two tasks it was asked about, which differ, and which of
 * them is harder. Comparisons are wins only (ADR-0003 §3a): "about the same" is a skip, which
 * records nothing.
 */
const fields = v.pipe(
  v.object({ tasks: v.strictTuple([taskId, taskId]), harder: taskId }),
  v.check(({ tasks: [first, second] }) => first !== second),
  v.check(({ tasks: pair, harder }) => pair.includes(harder)),
);

type AnswerComparisonResult =
  /** The names of the tasks, for saying what was recorded. */
  | { ok: true; harder: string; easier: string }
  /** Only a member with an account plays, for themselves (ADR-0003 §5, ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' }
  /** Not two different tasks of the household, one of them chosen. */
  | { ok: false; error: 'invalid' };

/**
 * Records the member's answer in the comparison game: which of two tasks of the household is
 * harder for them (ADR-0003 §3a), as evidence of their own, with when they gave it.
 */
export async function answerComparison(
  context: HouseholdContext,
  input: unknown,
): Promise<AnswerComparisonResult> {
  const self = context.member;
  if (!can(self, { action: 'comparison.play', member: self })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(fields, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const {
    tasks: [first, second],
    harder,
  } = parsed.output;
  const easier = harder === first ? second : first;
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<AnswerComparisonResult> => {
    // Row-level security hides every other household's tasks.
    const found = await tx
      .select({ id: tasks.id, name: tasks.name })
      .from(tasks)
      .where(inArray(tasks.id, [harder, easier]));
    const names = new Map(found.map(({ id, name }) => [id, name]));
    const harderName = names.get(harder);
    const easierName = names.get(easier);
    if (harderName === undefined || easierName === undefined) {
      return { ok: false, error: 'invalid' };
    }
    await tx.insert(comparisons).values({
      householdId,
      memberId: self.id,
      harderTaskId: harder,
      easierTaskId: easier,
      answeredAt: new Date(context.clock.now().epochMilliseconds),
    });
    return { ok: true, harder: harderName, easier: easierName };
  });
}
