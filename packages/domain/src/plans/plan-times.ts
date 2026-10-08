import type { AwayPeriod } from '../schedules/since-last-done';
import { planWeek, type HouseholdCalendar, type PlanWeek } from '../schedules/week';
import { awayThroughout } from './week-occurrences';

/**
 * When a household's plans are drafted and published: whole hours before the plan week starts, at
 * 00:00 on its first day in the household's time zone (ADR-0006 §2). The draft comes first.
 */
export interface PlanTimings {
  draft: number;
  publish: number;
}

/** A draft 48 hours before the week starts, published 12 hours before (ADR-0006 §2). */
export const defaultPlanTimings: PlanTimings = { draft: 48, publish: 12 };

/** Where a plan is: a draft only heads see, or published and frozen (ADR-0006 §2–§3). */
export type PlanStatus = 'draft' | 'published';

/** What the scheduler does to a plan week once its time has come (ADR-0006 §2). */
export type PlanStep = 'draft' | 'publish';

/**
 * The plan week after the one `now` falls in, in the household's time zone: the one the scheduler
 * plans next (ADR-0006 §2).
 */
export function nextPlanWeek(now: Temporal.Instant, calendar: HouseholdCalendar): PlanWeek {
  const today = now.toZonedDateTimeISO(calendar.timeZone).toPlainDate();
  return planWeek(planWeek(today, calendar).end, calendar);
}

/**
 * When `week`'s plan is drafted and when it is published: the timings' hours before the week
 * starts. Hours are elapsed time, so across a change of the clocks the local time is an hour off:
 * 48 hours before a Monday after the clocks went back is Saturday 01:00.
 */
export function planTimes(
  week: PlanWeek,
  calendar: HouseholdCalendar,
  timings: PlanTimings,
): Record<PlanStep, Temporal.Instant> {
  const start = week.start.toZonedDateTime({ timeZone: calendar.timeZone }).toInstant();
  return {
    draft: start.subtract({ hours: timings.draft }),
    publish: start.subtract({ hours: timings.publish }),
  };
}

/** A household as the scheduler sees it (ADR-0006 §2, ADR-0007 §2, ADR-0008 §10). */
export interface ScheduledHousehold {
  calendar: HouseholdCalendar;
  timings: PlanTimings;
  /** The first day of its first plan week, which Start records; none while it is in setup. */
  firstWeek: Temporal.PlainDate | undefined;
  away: readonly AwayPeriod[];
}

/**
 * The step the scheduler takes for `week` at `now`, if any (ADR-0006 §2, ADR-0008 §10): a draft
 * once its draft time has come and it has no plan yet, then publishing that draft once its publish
 * time has come. Nothing for a household in setup or a week before its first plan week (ADR-0007
 * §2), nor for a week the household is away for entirely, which gets no plan (ADR-0005 §5).
 */
export function duePlanStep(
  now: Temporal.Instant,
  week: PlanWeek,
  plan: PlanStatus | undefined,
  household: ScheduledHousehold,
): PlanStep | undefined {
  const { firstWeek } = household;
  if (!firstWeek || Temporal.PlainDate.compare(week.start, firstWeek) < 0) return undefined;
  if (awayThroughout(week, household.away)) return undefined;
  const times = planTimes(week, household.calendar, household.timings);
  const reached = (step: PlanStep) => Temporal.Instant.compare(now, times[step]) >= 0;
  if (plan === undefined) return reached('draft') ? 'draft' : undefined;
  if (plan === 'draft') return reached('publish') ? 'publish' : undefined;
  return undefined;
}
