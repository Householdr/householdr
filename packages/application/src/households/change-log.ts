import { activityLog, type ActivityAction, type Transaction } from '@householdr/db';
import { planningOf } from '../plans/planning';
import type { HouseholdContext } from './context';

/** What a head sets for a member, which the activity log shows (ADR-0018 §5). */
type SetForMember = Extract<
  ActivityAction,
  | 'share.changed'
  | 'temporary-share.added'
  | 'temporary-share.removed'
  | 'absence.added'
  | 'absence.removed'
>;

/**
 * How a change a head makes for a member is logged (ADR-0018 §5): once the household has started,
 * as an entry of its own that names the member and never a value; before, not at all, since the
 * start entry lists what was set then (ADR-0007 §2, ADR-0018 §5, clarifications). It locks the
 * household's row until the transaction ends, as Start does, so a change and Start wait for each
 * other and the change is either listed at Start or logged on its own, never neither. Call it
 * before locking a member's row, the order Start locks them in.
 */
export async function changeLog(tx: Transaction, context: HouseholdContext) {
  const { firstWeek } = await planningOf(tx, { lock: true });
  return async (action: SetForMember, subjectId: string) => {
    if (!firstWeek) return;
    await tx.insert(activityLog).values({
      householdId: context.householdId,
      at: new Date(context.clock.now().epochMilliseconds),
      actorId: context.member.id,
      action,
      subjectId,
    });
  };
}
