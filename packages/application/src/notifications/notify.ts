import { members, notifications, type Transaction } from '@householdr/db';
import { recipients, type NotificationEvent } from '@householdr/domain';

/** A plan's notification: what happened to the plan of which week. */
interface PlanNotification {
  event: NotificationEvent;
  /** The first day of the plan's week. */
  week: Temporal.PlainDate;
}

/**
 * Writes the notifications of what happened inside `tx`, the transaction of the change that caused
 * it, so neither is ever without the other (ADR-0014 §7): one for each member it is for, never
 * `actor`, whose own action it was (§2, clarification).
 */
export async function notify(
  tx: Transaction,
  householdId: string,
  at: Temporal.Instant,
  actor: string | undefined,
  { event, week }: PlanNotification,
) {
  const household = await tx
    .select({ id: members.id, role: members.role, accountId: members.accountId })
    .from(members);
  const told = recipients(
    event,
    household.map(({ id, role, accountId }) => ({ id, role, hasAccount: accountId !== null })),
    actor,
  );
  if (told.length === 0) return;
  await tx.insert(notifications).values(
    told.map((memberId) => ({
      householdId,
      memberId,
      kind: event.kind,
      at: new Date(at.epochMilliseconds),
      week: week.toString(),
    })),
  );
}
