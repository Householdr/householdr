import { absences, members, temporaryShares, type Transaction } from '@householdr/db';
import {
  availabilityInWeek,
  fairFractions,
  weekShare,
  type Absence,
  type Availability,
  type HouseholdCalendar,
  type PlanWeek,
} from '@householdr/domain';
import { and, gte, lt } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { basisOf } from '../shares/member-share';

// What drafting a week and settling it both read (ADR-0001 §6, ADR-0002 §1).

/** A member's fair portion of a plan week, with what it comes from. */
export interface FairPortion {
  id: string;
  /** A child's; none for an adult (ADR-0012 §2). */
  birthDate: Temporal.PlainDate | undefined;
  /** Their absences in the week, and the days the household is away, which are nobody's. */
  availability: Availability;
  /** Their fraction of the week's work: all members' add up to 1, or are all 0. */
  fairFraction: number;
}

/**
 * Each member's fair portion of plan week `week` as it stands (ADR-0001 §6): from their share,
 * temporary ones included, and the time they are available, both over the days the household is at
 * home, `away` being the days it isn't (ADR-0005 §5). Drafting reads it before the week, and
 * settling once it is over, when it has come out as the week ended up (ADR-0002 §1).
 */
export async function fairPortions(
  tx: Transaction,
  calendar: HouseholdCalendar,
  week: PlanWeek,
  away: readonly Absence[],
): Promise<FairPortion[]> {
  // Those of a period that touches the week: its last day in or after it, its first before its end.
  const inWeek = (first: AnyPgColumn, last: AnyPgColumn) =>
    and(gte(last, week.start.toString()), lt(first, week.end.toString()));
  const rows = await tx
    .select({
      id: members.id,
      role: members.role,
      birthDate: members.birthDate,
      sharePercent: members.sharePercent,
    })
    .from(members);
  const absent = await tx
    .select({ memberId: absences.memberId, from: absences.firstDay, to: absences.lastDay })
    .from(absences)
    .where(inWeek(absences.firstDay, absences.lastDay));
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
  const people = rows.map((row) => {
    const share = weekShare(
      {
        basis: basisOf(row),
        ...(row.sharePercent === null ? {} : { override: row.sharePercent / 100 }),
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
      unavailable: [],
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
