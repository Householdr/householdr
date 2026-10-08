import { planWeek, type HouseholdCalendar } from '../schedules/week';

/**
 * What a member's default share depends on (ADR-0001 §4). Only children have a birth date
 * (ADR-0012 §2).
 */
export type ShareBasis =
  { role: 'head' | 'adult' } | { role: 'child'; birthDate: Temporal.PlainDate };

/**
 * The shares a head can set instead of the default, in whole percent of a full share: from none to a
 * full one (ADR-0001 §4). Shares weigh members against each other, so someone does more when the
 * others' shares are lower.
 */
export const setShares = { min: 0, max: 100 } as const;

/** A share for a period, both dates included (ADR-0001 §4, clarification). */
export interface TemporaryShare {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
  share: number;
}

/** How a member's share is set (ADR-0001 §4). */
export interface ShareSettings {
  basis: ShareBasis;
  /** A head's choice instead of the default. */
  override?: number;
  /** Never overlapping, so each day has at most one (ADR-0001 §4, clarification). */
  temporary: readonly TemporaryShare[];
}

/**
 * The days a new temporary share can cover, given `today` in the household's time zone: from the
 * first day of this plan week, which has no plan yet, up to a year from today (ADR-0001 §4).
 */
export function temporaryShareDays(today: Temporal.PlainDate, calendar: HouseholdCalendar) {
  return { earliest: planWeek(today, calendar).start, latest: today.add({ years: 1 }) };
}

/**
 * Whether two temporary shares have a day in common, which a member's never do (ADR-0001 §4,
 * clarification).
 */
export function overlap(
  a: Pick<TemporaryShare, 'from' | 'to'>,
  b: Pick<TemporaryShare, 'from' | 'to'>,
): boolean {
  return (
    Temporal.PlainDate.compare(a.from, b.to) <= 0 && Temporal.PlainDate.compare(b.from, a.to) <= 0
  );
}

/**
 * A member's share for the plan week of `date`: the override or the default on the week's first
 * day, replaced by a temporary share on the days it covers, averaged over the week's days: seven,
 * or the transition week's actual length (ADR-0001 §4, ADR-0006 §1, clarifications).
 */
export function weekShare(
  settings: ShareSettings,
  date: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): number {
  const { start, end } = planWeek(date, calendar);
  const length = start.until(end).days;
  const base = settings.override ?? defaultShare(settings.basis, start);
  let share = base;
  for (let day = 0; day < length; day++) {
    const temporary = settings.temporary.find((t) => covers(t, start.add({ days: day })));
    if (temporary) share += (temporary.share - base) / length;
  }
  return share;
}

/**
 * A child's share by age in whole years: 0 under 4, then linear from 0.1 at 4 to 1.0 at 18
 * (ADR-0001 §4, clarification). Temporal counts a 29 February birthday from 1 March in other years.
 */
export function ageShare(birthDate: Temporal.PlainDate, date: Temporal.PlainDate): number {
  const age = birthDate.until(date, { largestUnit: 'years' }).years;
  if (age < 4) return 0;
  if (age >= 18) return 1;
  return 0.1 + ((age - 4) * 0.9) / 14;
}

function defaultShare(basis: ShareBasis, date: Temporal.PlainDate) {
  return basis.role === 'child' ? ageShare(basis.birthDate, date) : 1;
}

function covers(temporary: TemporaryShare, date: Temporal.PlainDate) {
  return (
    Temporal.PlainDate.compare(temporary.from, date) <= 0 &&
    Temporal.PlainDate.compare(date, temporary.to) <= 0
  );
}
