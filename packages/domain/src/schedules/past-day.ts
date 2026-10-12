import { planWeek, type HouseholdCalendar } from './week';

/**
 * How long ago a day was, in words as vague as the scale of the clarification of ADR-0008 §6: never
 * finer than the day, since when someone was active isn't shared (ADR-0018 §3).
 */
export type PastDay =
  'today' | 'yesterday' | 'some-days-ago' | 'last-week' | 'some-weeks-ago' | 'older';

/**
 * How long before `today` the day `day` was: today, yesterday, two to six days ago, in the plan
 * week before this one, less than five weeks ago, or longer ago, which is then said exactly
 * (ADR-0008 §6, clarification). Plan weeks are the household's, so a changed start day counts.
 */
export function pastDay(
  day: Temporal.PlainDate,
  today: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): PastDay {
  const days = day.until(today, { largestUnit: 'days' }).days;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'some-days-ago';
  const lastWeek = planWeek(planWeek(today, calendar).start.subtract({ days: 1 }), calendar);
  if (Temporal.PlainDate.compare(day, lastWeek.start) >= 0) return 'last-week';
  return days < 35 ? 'some-weeks-ago' : 'older';
}
