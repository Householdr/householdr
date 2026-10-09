import { activityLog, households, inHousehold, members, type ActivityAction } from '@householdr/db';
import { can } from '@householdr/domain';
import { desc, eq } from 'drizzle-orm';
import type { HouseholdContext } from './membership';

/** How many entries the log shows, newest first. */
const shown = 100;

/**
 * The members a start entry lists, by name, or null for each former member (ADR-0012 §6): whose
 * share was set before the start, and for which profiles without an account days away were planned
 * (ADR-0007 §2, clarification). Never a value.
 */
export interface SetBeforeStartNames {
  shares: (string | null)[];
  daysAway: (string | null)[];
}

/** An entry of the activity log, as every member sees it (ADR-0018 §5). */
export interface ActivityEntry {
  id: string;
  at: Temporal.Instant;
  /** The name of who did it, or null for a former member (ADR-0012 §6). */
  actor: string | null;
  action: ActivityAction;
  /** For the start entry, what was set for other members before; null for any other. */
  setBeforeStart: SetBeforeStartNames | null;
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
        setBeforeStart: activityLog.setBeforeStart,
      })
      .from(activityLog)
      .leftJoin(members, eq(members.id, activityLog.actorId))
      .orderBy(desc(activityLog.at), desc(activityLog.id))
      .limit(shown);
    const names = rows.some((row) => row.setBeforeStart !== null)
      ? new Map(
          (await tx.select({ id: members.id, name: members.name }).from(members)).map((m) => [
            m.id,
            m.name,
          ]),
        )
      : new Map<string, string>();
    // By name, former members last: an id whose profile is gone names nobody.
    const named = (ids: string[]) =>
      ids
        .map((id) => names.get(id) ?? null)
        .sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
    const entries = rows.map(({ at, setBeforeStart, ...row }) => ({
      ...row,
      at: Temporal.Instant.fromEpochMilliseconds(at.getTime()),
      setBeforeStart: setBeforeStart && {
        shares: named(setBeforeStart.shares),
        daysAway: named(setBeforeStart.daysAway),
      },
    }));
    return { ok: true as const, timeZone: household.timeZone, entries };
  });
}
