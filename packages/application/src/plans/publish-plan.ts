import { assignments, inHousehold, nextVersion, plans } from '@householdr/db';
import { planWeek } from '@householdr/domain';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as v from 'valibot';
import { notify } from '../notifications/notify';
import { mayDraft, planningOf, weekInput, type PlanContext } from './planning';

/** What publishing sends (CODE-12): the week, and for a head, the version of the draft they saw. */
const publishInput = v.object({
  ...weekInput.entries,
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

type PublishPlanResult =
  | { ok: true }
  /** Only heads publish early, once signed in with two factors, besides the scheduler. */
  | { ok: false; error: 'not-allowed' }
  /** Not a day, or a head's without the version of the draft they saw. */
  | { ok: false; error: 'invalid' }
  /** The week has no draft: none was made, as for a week the household is away for. */
  | { ok: false; error: 'not-found' }
  /** The draft was drafted again since the head saw it, so nothing was published (ADR-0019 §5). */
  | { ok: false; error: 'conflict' };

/**
 * Publishes the draft of the plan week of `week`, any of its days (ADR-0006 §2): every member sees
 * it from now on, and it is frozen (§3). The scheduler does it at the household's publish time; a
 * head can do it earlier, for the draft they saw. Each member with an occurrence in it is notified,
 * but for the head who published it (ADR-0014 §2, clarification). A plan published already stays
 * as it was.
 */
export async function publishPlan(
  context: PlanContext,
  input: unknown,
): Promise<PublishPlanResult> {
  if (!mayDraft(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(publishInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { version } = parsed.output;
  const byHead = context.member !== 'scheduler';
  if (byHead && version === undefined) return { ok: false, error: 'invalid' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<PublishPlanResult> => {
    const { calendar } = await planningOf(tx, { lock: true });
    const week = planWeek(parsed.output.week, calendar);
    const [plan] = await tx
      .select({ id: plans.id, status: plans.status, version: plans.version })
      .from(plans)
      .where(eq(plans.weekStart, week.start.toString()));
    if (!plan) return { ok: false, error: 'not-found' };
    // Publishing twice changes nothing (CODE-19).
    if (plan.status === 'published') return { ok: true };
    if (byHead && plan.version !== version) return { ok: false, error: 'conflict' };
    const now = context.clock.now();
    await tx
      .update(plans)
      .set({
        status: 'published',
        publishedAt: new Date(now.epochMilliseconds),
        version: nextVersion(plans),
      })
      .where(and(eq(plans.id, plan.id), eq(plans.status, 'draft')));
    // Each member with an occurrence in it hears of it (ADR-0006 §5, ADR-0014 §2).
    const given = await tx
      .selectDistinct({ memberId: assignments.memberId })
      .from(assignments)
      .where(and(eq(assignments.planId, plan.id), isNotNull(assignments.memberId)));
    const assigned = new Set(given.flatMap(({ memberId }) => (memberId ? [memberId] : [])));
    const actor = context.member === 'scheduler' ? undefined : context.member.id;
    await notify(tx, context.householdId, now, actor, {
      event: { kind: 'plan.published', assigned },
      week: week.start,
    });
    return { ok: true };
  });
}
