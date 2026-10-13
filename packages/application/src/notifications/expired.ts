import { inHousehold, notifications, startedHouseholds } from '@householdr/db';
import { lt } from 'drizzle-orm';
import type { HouseholdsContext } from '../households/context';
import type { Clock } from '../ports';

/** How long an in-app notification is kept (ADR-0014 §7, ADR-0012 §5). */
const kept = Temporal.Duration.from({ hours: 90 * 24 });

/**
 * Deletes the in-app notifications created more than 90 days ago, household by household (ADR-0014
 * §7, clarification). Every one so far is about a plan, so only households past setup, which have
 * plans, have any (ADR-0007 §2). Running twice deletes nothing more (CODE-19).
 */
export async function deleteExpiredNotifications(context: HouseholdsContext & { clock: Clock }) {
  const before = new Date(context.clock.now().subtract(kept).epochMilliseconds);
  for (const householdId of await startedHouseholds(context.db)) {
    await inHousehold(context.db, householdId, (tx) =>
      tx.delete(notifications).where(lt(notifications.at, before)),
    );
  }
}
