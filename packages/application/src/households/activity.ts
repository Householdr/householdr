import { activityLog, inHousehold, members, type ActivityAction } from '@householdr/db';
import { can, pastDay, type PastDay } from '@householdr/domain';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { thisWeek } from '../shares/member-share';
import { shownName } from './former-members';
import type { HouseholdContext } from './membership';

/** How many entries the log shows, newest first. */
const shown = 100;

/**
 * The members a start entry lists, by name, or null for each former member (ADR-0012 §6): whose
 * share was set before the start, and for which profiles without an account days away were planned
 * (ADR-0007 §2, clarification). Never a value. The reader isn't among the names: whether they are
 * listed is said apart, since the log calls them "you" (ADR-0018 §5, clarification).
 */
export interface SetBeforeStartNames {
  shares: (string | null)[];
  daysAway: (string | null)[];
  reader: { shares: boolean; daysAway: boolean };
}

/** An entry of the activity log, as every member sees it (ADR-0018 §5). */
export interface ActivityEntry {
  id: string;
  at: Temporal.Instant;
  /** The day it was, in the household's time zone. */
  day: Temporal.PlainDate;
  /** How long ago that day was, never finer than the day (ADR-0008 §6, ADR-0018 §3). */
  when: PastDay;
  /** The name of who did it, or null for a former member (ADR-0012 §6). */
  actor: string | null;
  action: ActivityAction;
  /**
   * For the entries done to someone, such as logging a completion on their behalf, their name, or
   * null for a former member; null for any other.
   */
  subject: string | null;
  /** For the start entry, what was set before, the starter's own share included; null for any other. */
  setBeforeStart: SetBeforeStartNames | null;
  /** Whether the reader did it, so the log says "you" (ADR-0018 §5, clarification). */
  byReader: boolean;
  /** Whether it was done to the reader. */
  toReader: boolean;
  /** Whether it was done by whom it was done to, such as a head changing their own share. */
  toActor: boolean;
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
    const { today, calendar } = await thisWeek(tx, context);
    const subjects = alias(members, 'subjects');
    const rows = await tx
      .select({
        id: activityLog.id,
        at: activityLog.at,
        actorId: activityLog.actorId,
        actor: shownName(),
        action: activityLog.action,
        subjectId: activityLog.subjectId,
        subject: shownName(subjects),
        setBeforeStart: activityLog.setBeforeStart,
      })
      .from(activityLog)
      .leftJoin(members, eq(members.id, activityLog.actorId))
      .leftJoin(subjects, eq(subjects.id, activityLog.subjectId))
      .orderBy(desc(activityLog.at), desc(activityLog.id))
      .limit(shown);
    const names = rows.some((row) => row.setBeforeStart !== null)
      ? new Map(
          (await tx.select({ id: members.id, name: shownName() }).from(members)).map((m) => [
            m.id,
            m.name,
          ]),
        )
      : new Map<string, string>();
    const reader = context.member.id;
    // By name, former members last: an id whose profile is gone names nobody.
    const named = (ids: string[]) =>
      ids
        .filter((id) => id !== reader)
        .map((id) => names.get(id) ?? null)
        .sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
    const entries = rows.map(({ at, setBeforeStart, actorId, subjectId, ...row }) => {
      const instant = Temporal.Instant.fromEpochMilliseconds(at.getTime());
      const day = instant.toZonedDateTimeISO(calendar.timeZone).toPlainDate();
      return {
        ...row,
        at: instant,
        day,
        when: pastDay(day, today, calendar),
        setBeforeStart: setBeforeStart && {
          shares: named(setBeforeStart.shares),
          daysAway: named(setBeforeStart.daysAway),
          reader: {
            shares: setBeforeStart.shares.includes(reader),
            daysAway: setBeforeStart.daysAway.includes(reader),
          },
        },
        byReader: actorId === reader,
        toReader: subjectId === reader,
        // A former member's ids are gone, so whether they acted on themselves is no longer known.
        toActor: actorId !== null && actorId === subjectId,
      };
    });
    return { ok: true as const, timeZone: calendar.timeZone, entries };
  });
}
