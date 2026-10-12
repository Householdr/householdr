import { households, members, temporaryShares, type Transaction } from '@householdr/db';
import {
  overlap,
  planWeek,
  weekShare,
  type HouseholdCalendar,
  type Member,
  type PlanWeek,
  type Role,
  type ShareBasis,
} from '@householdr/domain';
import { and, asc, gte, inArray } from 'drizzle-orm';
import type { HouseholdContext } from '../households/context';

/** A temporary share, both days included, as `YYYY-MM-DD` (ADR-0001 §4, clarifications). */
export interface PlannedShare {
  id: string;
  firstDay: string;
  lastDay: string;
  /** In whole percent of a full share. */
  percent: number;
}

/** A member's share, as they and the heads see it, and nobody else (ADR-0018 §4). */
export interface MemberShare {
  id: string;
  name: string;
  role: Role;
  /** Their share this plan week, in whole percent of a full share (ADR-0001 §4). */
  percent: number;
  /** The share a head set instead of the default by role and age, if any. */
  set: number | null;
  /** Their temporary shares from this plan week on, soonest first. */
  temporary: PlannedShare[];
  /** Whether one of them covers a day of this plan week, which makes it its share on that day. */
  temporaryThisWeek: boolean;
  /** What a change is made from (ADR-0019 §5). */
  version: number;
}

export const shareColumns = {
  id: members.id,
  name: members.name,
  role: members.role,
  birthDate: members.birthDate,
  accountId: members.accountId,
  sharePercent: members.sharePercent,
  version: members.version,
};

/** A member's row, with what their share depends on. */
export interface ShareRow {
  id: string;
  name: string;
  role: Role;
  birthDate: string | null;
  accountId: string | null;
  sharePercent: number | null;
  version: number;
}

/** A member as permissions see the one acted on (ADR-0018 §4). */
export const seen = (row: ShareRow): Member => ({
  id: row.id,
  role: row.role,
  hasAccount: row.accountId !== null,
  twoFactor: false,
});

/** Today in the household's time zone, its calendar, and the plan week they place. */
export interface Week {
  today: Temporal.PlainDate;
  calendar: HouseholdCalendar;
  week: PlanWeek;
}

/** The columns of `households` its calendar comes from. */
export const calendarColumns = {
  timeZone: households.timeZone,
  weekStartDay: households.weekStartDay,
  changeFrom: households.weekStartChangeFrom,
  previousDay: households.weekStartPreviousDay,
};

/** The household's calendar from its row: its time zone, start day and latest change of it. */
export function calendarOf(row: {
  timeZone: string;
  weekStartDay: HouseholdCalendar['weekStartDay'];
  changeFrom: string | null;
  previousDay: HouseholdCalendar['weekStartDay'] | null;
}): HouseholdCalendar {
  const { timeZone, weekStartDay, changeFrom, previousDay } = row;
  return changeFrom !== null && previousDay !== null
    ? {
        timeZone,
        weekStartDay,
        change: { from: Temporal.PlainDate.from(changeFrom), previous: previousDay },
      }
    : { timeZone, weekStartDay };
}

export async function thisWeek(tx: Transaction, context: HouseholdContext): Promise<Week> {
  const [household] = await tx.select(calendarColumns).from(households);
  if (!household) throw new Error('The household of a member is gone.');
  const calendar = calendarOf(household);
  const today = context.clock.now().toZonedDateTimeISO(calendar.timeZone).toPlainDate();
  return { today, calendar, week: planWeek(today, calendar) };
}

/** The shares of the members of `rows`, with their temporary shares from this plan week on. */
export async function sharesOf(
  tx: Transaction,
  rows: readonly ShareRow[],
  now: Week,
): Promise<MemberShare[]> {
  if (rows.length === 0) return [];
  const planned = await tx
    .select({
      id: temporaryShares.id,
      memberId: temporaryShares.memberId,
      firstDay: temporaryShares.firstDay,
      lastDay: temporaryShares.lastDay,
      percent: temporaryShares.percent,
    })
    .from(temporaryShares)
    .where(
      and(
        inArray(
          temporaryShares.memberId,
          rows.map((row) => row.id),
        ),
        gte(temporaryShares.lastDay, now.week.start.toString()),
      ),
    )
    .orderBy(asc(temporaryShares.firstDay));
  return rows.map((row) =>
    shareOf(
      row,
      planned
        .filter(({ memberId }) => memberId === row.id)
        .map(({ id, firstDay, lastDay, percent }) => ({ id, firstDay, lastDay, percent })),
      now,
    ),
  );
}

/**
 * The member's share this plan week: set by a head, or by role and age, and replaced by a
 * temporary share on the days it covers (ADR-0001 §4).
 */
function shareOf(row: ShareRow, temporary: PlannedShare[], now: Week): MemberShare {
  const set = row.sharePercent;
  const periods = temporary.map(({ firstDay, lastDay, percent }) => ({
    from: Temporal.PlainDate.from(firstDay),
    to: Temporal.PlainDate.from(lastDay),
    share: percent / 100,
  }));
  const share = weekShare(
    { basis: basisOf(row), ...(set === null ? {} : { override: set / 100 }), temporary: periods },
    now.today,
    now.calendar,
  );
  const days = { from: now.week.start, to: now.week.end.subtract({ days: 1 }) };
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    percent: Math.round(share * 100),
    set,
    temporary,
    temporaryThisWeek: periods.some((period) => overlap(period, days)),
    version: row.version,
  };
}

/** What a member's default share depends on: their role and, for a child, their age. */
export function basisOf(row: Pick<ShareRow, 'role' | 'birthDate'>): ShareBasis {
  if (row.role !== 'child') return { role: row.role };
  if (row.birthDate === null) throw new Error('A child without a birth date.');
  return { role: 'child', birthDate: Temporal.PlainDate.from(row.birthDate) };
}
