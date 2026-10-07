// Business rules as pure functions over plain data: no I/O, no clock, no randomness (ADR-0008 §3, CODE-5).
export { expand } from './schedules/expand';
export { frequencyRule, type Frequency } from './schedules/frequency';
export {
  occurrences,
  oneOffOccurrence,
  type Occurrence,
  type Timing,
  type Window,
  type WindowEdge,
} from './schedules/occurrence';
export type { Rule, Schedule, Season } from './schedules/schedule';
export {
  dueDate,
  dueness,
  sinceLastDoneOccurrence,
  type AwayPeriod,
  type Dueness,
  type Interval,
  type SinceLastDone,
} from './schedules/since-last-done';
export { planWeekStart, type HouseholdCalendar } from './schedules/week';
