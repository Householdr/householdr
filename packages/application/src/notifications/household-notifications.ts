import { households, inHousehold, notifications, plans } from '@householdr/db';
import { can, pastDay, type NotificationKind, type PastDay } from '@householdr/domain';
import { and, desc, eq } from 'drizzle-orm';
import type { HouseholdContext } from '../households/context';
import { thisWeek } from '../shares/member-share';

/**
 * A notification in the member's list (ADR-0014 §7, clarification): what happened and what it is
 * about, which the page puts in the reader's words (§6).
 */
export interface HouseholdNotification {
  id: string;
  kind: NotificationKind;
  /** The day it came, in the household's time zone. */
  day: Temporal.PlainDate;
  /** How long ago that day was, never finer than the day (ADR-0008 §6, ADR-0018 §3). */
  when: PastDay;
  /** The first and the last day of the week of the plan it is about. */
  week: { first: Temporal.PlainDate; last: Temporal.PlainDate };
}

type HouseholdNotificationsResult =
  | { ok: true; household: string; notifications: HouseholdNotification[] }
  | { ok: false; error: 'not-allowed' };

/**
 * The member's own notifications from the household, newest first, which nobody else sees
 * (ADR-0014 §7, clarification), with the household's name, since each names where it comes from
 * (§3). What is older than 90 days is gone already (§7).
 */
export async function householdNotifications(
  context: HouseholdContext,
): Promise<HouseholdNotificationsResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const { today, calendar } = await thisWeek(tx, context);
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        at: notifications.at,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
      })
      .from(notifications)
      // Every notification so far is about a plan, which it goes with (`notifications_plan`).
      .innerJoin(
        plans,
        and(
          eq(plans.householdId, notifications.householdId),
          eq(plans.weekStart, notifications.week),
        ),
      )
      .where(eq(notifications.memberId, context.member.id))
      .orderBy(desc(notifications.at), desc(notifications.id));
    const list = rows.map(({ id, kind, at, weekStart, weekEnd }) => {
      const day = Temporal.Instant.fromEpochMilliseconds(at.getTime())
        .toZonedDateTimeISO(calendar.timeZone)
        .toPlainDate();
      // A plan’s end is the first day of the next week.
      const week = {
        first: Temporal.PlainDate.from(weekStart),
        last: Temporal.PlainDate.from(weekEnd).subtract({ days: 1 }),
      };
      return { id, kind, day, when: pastDay(day, today, calendar), week };
    });
    return { ok: true as const, household: household.name, notifications: list };
  });
}
