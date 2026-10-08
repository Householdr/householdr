import { activityLog, households, inHousehold, members, type ActivityAction } from '@householdr/db';
import { can } from '@householdr/domain';
import { desc, eq } from 'drizzle-orm';
import type { HouseholdContext } from './membership';

/** How many entries the log shows, newest first. */
const shown = 100;

/** An entry of the activity log, as every member sees it (ADR-0018 §5). */
export interface ActivityEntry {
  id: string;
  at: Temporal.Instant;
  /** The name of who did it, or null for a former member (ADR-0012 §6). */
  actor: string | null;
  action: ActivityAction;
}

type HouseholdActivityResult =
  { ok: true; timeZone: string; entries: ActivityEntry[] } | { ok: false; error: 'not-allowed' };

/**
 * The household's activity log, newest first, which every member sees, children included
 * (ADR-0018 §5), with the household's time zone to show the days in.
 */
export async function householdActivity(
  context: HouseholdContext,
): Promise<HouseholdActivityResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const rows = await tx
      .select({
        id: activityLog.id,
        at: activityLog.at,
        actor: members.name,
        action: activityLog.action,
      })
      .from(activityLog)
      .leftJoin(members, eq(members.id, activityLog.actorId))
      .orderBy(desc(activityLog.at), desc(activityLog.id))
      .limit(shown);
    const entries = rows.map((row) => ({
      ...row,
      at: Temporal.Instant.fromEpochMilliseconds(row.at.getTime()),
    }));
    return { ok: true as const, timeZone: household.timeZone, entries };
  });
}
