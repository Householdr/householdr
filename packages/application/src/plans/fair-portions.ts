import {
  absences,
  members,
  temporaryShares,
  unavailabilities,
  type Transaction,
} from '@householdr/db';
import {
  availabilityInWeek,
  fairFractions,
  weekShare,
  type Absence,
  type Availability,
  type HouseholdCalendar,
  type PlanWeek,
  type Window,
} from '@householdr/domain';
import { and, gt, gte, isNull, lt, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { basisOf } from '../shares/member-share';
import { sharesInWeek } from '../shares/share-changes';

// What drafting a week and settling it both read (ADR-0001 §6, ADR-0002 §1).

/** A member's fair portion of a plan week, with what it comes from. */
export interface FairPortion {
  id: string;
  /** A child's; none for an adult (ADR-0012 §2). */
  birthDate: Temporal.PlainDate | undefined;
  /**
   * Their absences and times they couldn't in the week, and the days the household is away, which
   * are nobody's.
   */
  availability: Availability;
  /** Their fraction of the week's work: all members' add up to 1, or are all 0. */
  fairFraction: number;
}

/**
 * Each member's fair portion of plan week `week` as it stands (ADR-0001 §6): from their share in
 * that week, temporary ones included, and the time they are available, both over the days the
 * household is at home, `away` being the days it isn't (ADR-0005 §5). Drafting reads it before the
 * week, and settling once it is over, when it has come out as the week ended up (ADR-0002 §1). A
 * member who joined after `draftedAt`, when the week's plan was drafted, has none: the plan didn't
 * include them (ADR-0002 §1, clarification). A former member's counts up to the moment they left,
 * and they have none of a later week (ADR-0005 §4, clarification).
 */
export async function fairPortions(
  tx: Transaction,
  calendar: HouseholdCalendar,
  week: PlanWeek,
  away: readonly Absence[],
  { draftedAt }: { draftedAt?: Date } = {},
): Promise<FairPortion[]> {
  // Those of a period that touches the week: its last day in or after it, its first before its end.
  const inWeek = (first: AnyPgColumn, last: AnyPgColumn) =>
    and(gte(last, week.start.toString()), lt(first, week.end.toString()));
  const midnight = (day: Temporal.PlainDate) =>
    new Date(day.toZonedDateTime({ timeZone: calendar.timeZone }).epochMilliseconds);
  const rows = await tx
    .select({
      id: members.id,
      role: members.role,
      birthDate: members.birthDate,
      sharePercent: members.sharePercent,
      joinedAt: members.joinedAt,
      leftAt: members.leftAt,
    })
    .from(members)
    // Not a former member who left before the week (ADR-0005 §4, clarification).
    .where(or(isNull(members.leftAt), gt(members.leftAt, midnight(week.start))));
  // The share a member had in this week, where a change to it was kept (ADR-0002 §1, clarification).
  const kept = await sharesInWeek(tx, week);
  const absent = await tx
    .select({ memberId: absences.memberId, from: absences.firstDay, to: absences.lastDay })
    .from(absences)
    .where(inWeek(absences.firstDay, absences.lastDay));
  // "I can't today" as it ended up: until its day's end, or until they could after all (ADR-0005
  // §3, ADR-0002 §1).
  const unavailable = await tx
    .select({
      memberId: unavailabilities.memberId,
      startsAt: unavailabilities.startsAt,
      endsAt: unavailabilities.endsAt,
    })
    .from(unavailabilities)
    .where(
      and(
        gt(unavailabilities.endsAt, midnight(week.start)),
        lt(unavailabilities.startsAt, midnight(week.end)),
      ),
    );
  const temporary = await tx
    .select({
      memberId: temporaryShares.memberId,
      from: temporaryShares.firstDay,
      to: temporaryShares.lastDay,
      percent: temporaryShares.percent,
    })
    .from(temporaryShares)
    .where(inWeek(temporaryShares.firstDay, temporaryShares.lastDay));
  const day = (iso: string) => Temporal.PlainDate.from(iso);
  const weekEnd = midnight(week.end);
  const zoned = (at: Date) =>
    Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(calendar.timeZone);
  const people = rows.map((row) => {
    const percent = kept.has(row.id) ? (kept.get(row.id) ?? null) : row.sharePercent;
    const joinedLater = draftedAt !== undefined && row.joinedAt > draftedAt;
    const share = joinedLater
      ? 0
      : weekShare(
          {
            basis: basisOf(row),
            ...(percent === null ? {} : { override: percent / 100 }),
            temporary: temporary
              .filter((t) => t.memberId === row.id)
              .map((t) => ({ from: day(t.from), to: day(t.to), share: t.percent / 100 })),
          },
          week.start,
          calendar,
          away,
        );
    const availability = {
      absences: [
        ...absent
          .filter((a) => a.memberId === row.id)
          .map((a) => ({ from: day(a.from), to: day(a.to) })),
        // The days the household is away count as nobody's: the week is planned for the days at
        // home, with fair portions over those days (ADR-0005 §5).
        ...away,
      ],
      unavailable: [
        ...unavailable
          .filter((u) => u.memberId === row.id)
          .map((u): Window => ({ start: zoned(u.startsAt), end: zoned(u.endsAt) })),
        // One who left in the week counts up to the moment they left (ADR-0005 §4, clarification).
        ...(row.leftAt !== null && row.leftAt < weekEnd
          ? [{ start: zoned(row.leftAt), end: zoned(weekEnd) }]
          : []),
      ],
    };
    return { row, share, availability };
  });
  const fractions = fairFractions(
    people.map(({ share, availability }) => ({
      share,
      availability: availabilityInWeek(availability, week.start, calendar),
    })),
  );
  return people.map(({ row, availability }, index) => ({
    id: row.id,
    birthDate: row.birthDate === null ? undefined : day(row.birthDate),
    availability,
    fairFraction: fractions[index] ?? 0,
  }));
}
