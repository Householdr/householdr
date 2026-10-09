import type { AwayPeriod } from '../schedules/since-last-done';
import { planWeek, type HouseholdCalendar, type PlanWeek } from '../schedules/week';
import { awayThroughout } from './week-occurrences';

/**
 * When a household's plans are drafted and published: whole hours before the plan week starts, at
 * 00:00 on its first day, on the household's local clock (ADR-0006 §2, clarification). The draft
 * comes first.
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
 * starts, counted on the household's local clock (ADR-0006 §2, clarification), so 48 hours before
 * a Monday is Saturday 00:00, also when the clocks change that weekend. A time the clocks skip
 * comes as much later as they skip, and one they go through twice is the first of the two.
 */
export function planTimes(
  week: PlanWeek,
  calendar: HouseholdCalendar,
  timings: PlanTimings,
): Record<PlanStep, Temporal.Instant> {
  const start = week.start.toPlainDateTime();
  const before = (hours: number) =>
    start.subtract({ hours }).toZonedDateTime(calendar.timeZone).toInstant();
  return { draft: before(timings.draft), publish: before(timings.publish) };
}

/** A household as the scheduler sees it (ADR-0006 §2, ADR-0007 §2, ADR-0008 §10). */
export interface ScheduledHousehold {
  calendar: HouseholdCalendar;
  timings: PlanTimings;
  /** The first day of its first plan week, which Start records; none while it is in setup. */
  firstWeek: Temporal.PlainDate | undefined;
  /** Whether it started now, with its first week's draft made at once (ADR-0007 §3). */
  startedNow: boolean;
  away: readonly AwayPeriod[];
}

/**
 * The step the scheduler takes for `week` at `now`, if any (ADR-0006 §2, ADR-0008 §10): a draft
 * once its draft time has come and it has no plan yet, then publishing that draft once its publish
 * time has come. Nothing for a household in setup or a week before its first plan week (ADR-0007
 * §2), nor for a week the household is away for entirely, which gets no plan (ADR-0005 §5). The
 * draft a household starting now gets for its first week waits for a head to publish it, however
 * late it is (ADR-0006 §2, ADR-0007 §3, clarifications).
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
  if (plan === 'draft') {
    if (household.startedNow && week.start.equals(firstWeek)) return undefined;
    return reached('publish') ? 'publish' : undefined;
  }
  return undefined;
}
