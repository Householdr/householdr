import { householdDate } from '../households/date';
import { planWeek, type HouseholdCalendar, type PlanWeek } from '../schedules/week';
import { nextPlanWeek, planTimes, type PlanStep, type PlanTimings } from './plan-times';

/**
 * When a household starts, which a head chooses at the last step of setting it up (ADR-0007 §2,
 * §3): now, with this plan week planned for the days left, or on the week start day, with the next
 * plan week as its first.
 */
export type StartChoice = 'now' | 'week start';

export const startChoices: readonly StartChoice[] = ['now', 'week start'];

/** Start now, unless the head chooses otherwise (ADR-0007 §2). */
export const defaultStart: StartChoice = 'now';

/**
 * The first plan week of a household that starts at `now` (ADR-0007 §3): the one `now` falls in,
 * whose days before today are then gone, or the next one.
 */
export function firstPlanWeek(
  when: StartChoice,
  now: Temporal.Instant,
  calendar: HouseholdCalendar,
): PlanWeek {
  if (when === 'week start') return nextPlanWeek(now, calendar);
  return planWeek(householdDate(now, calendar.timeZone), calendar);
}

/**
 * When the scheduler drafts and publishes `week`'s plan, as seen at `now` (ADR-0006 §2, ADR-0008
 * §10): at each step's time, or at once if that has passed, as for a household that starts on the
 * week start day after the draft time.
 */
export function comingPlanTimes(
  now: Temporal.Instant,
  week: PlanWeek,
  calendar: HouseholdCalendar,
  timings: PlanTimings,
): Record<PlanStep, Temporal.Instant> {
  const times = planTimes(week, calendar, timings);
  const notBefore = (at: Temporal.Instant) => (Temporal.Instant.compare(at, now) < 0 ? now : at);
  return { draft: notBefore(times.draft), publish: notBefore(times.publish) };
}
