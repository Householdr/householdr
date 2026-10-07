import { isAvailableDuring, type Availability } from '../availability/availability';
import type { Window } from '../schedules/occurrence';
import { planWeekStart, type HouseholdCalendar } from '../schedules/week';

/**
 * A head's setting for one task and member (ADR-0001 §1, §3): always theirs, never theirs, or allowed
 * below the task's minimum age.
 */
export type Constraint = 'bound' | 'excluded' | 'allowed';

/** A member as eligibility sees them (ADR-0001 §7, clarification). */
export interface Candidate {
  id: string;
  /** Their fair portion of the plan week (ADR-0001 §6); 0 means no occurrences. */
  fairFraction: number;
  availability: Availability;
  /** Only children have one (ADR-0012 §2). */
  birthDate?: Temporal.PlainDate;
}

/** What a task says about who can take it (ADR-0001 §1, §3). */
export interface TaskRules {
  minimumAge?: number;
  /** By member id; a member without one has none. */
  constraints: ReadonlyMap<string, Constraint>;
}

/**
 * Whether a member can take an occurrence of a task in the plan week of `date` (ADR-0001 §7,
 * clarification): not excluded, old enough on the week's first day unless allowed or bound, with a
 * fair portion, and available during any part of the window.
 */
export function isEligible(
  member: Candidate,
  task: TaskRules,
  window: Window,
  date: Temporal.PlainDate,
  calendar: HouseholdCalendar,
): boolean {
  const constraint = task.constraints.get(member.id);
  if (constraint === 'excluded' || member.fairFraction <= 0) return false;
  if (!constraint && !oldEnough(member, task, planWeekStart(date, calendar.weekStartDay))) {
    return false;
  }
  return isAvailableDuring(member.availability, window, calendar);
}

function oldEnough(member: Candidate, task: TaskRules, weekStart: Temporal.PlainDate) {
  if (task.minimumAge === undefined || !member.birthDate) return true;
  return member.birthDate.until(weekStart, { largestUnit: 'years' }).years >= task.minimumAge;
}
