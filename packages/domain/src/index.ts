// Business rules as pure functions over plain data: no I/O, no clock, no randomness (ADR-0008 §3, CODE-5).
export {
  allocate,
  type Allocation,
  type AllocationInput,
  type AllocationMember,
  type AllocationTask,
  type Assignment,
  type Reason,
  type UnassignedCause,
} from './allocation/allocate';
export {
  isEligible,
  type Candidate,
  type Constraint,
  type TaskRules,
} from './allocation/eligibility';
export { allocationUnits, linkedPairs, type PlannedOccurrence } from './allocation/units';
export {
  availabilityInWeek,
  availableWindows,
  isAvailableDuring,
  type Absence,
  type Availability,
  type AvailabilityPattern,
} from './availability/availability';
export { plannableDays, unplannableEnds, type AbsenceEnd } from './availability/planned-absence';
export {
  estimateBurdens,
  type BurdenEstimate,
  type BurdenTask,
  type Evidence,
} from './burdens/estimate';
export {
  completionCredits,
  defaultRebalance,
  rebalanceRates,
  settleWeek,
  type CostedTask,
  type Points,
  type RebalancePreset,
  type WeekSettlement,
} from './ledger/settlement';
export {
  countries,
  countryOfTimeZone,
  isCountry,
  timeZonesOf,
  type Country,
} from './households/countries';
export { householdDate } from './households/date';
export {
  canForAccount,
  type Account,
  type AccountAction,
  type SignedIn,
} from './permissions/account';
export {
  can,
  type Member,
  type MemberAction,
  type Permission,
  type Role,
} from './permissions/household';
export {
  defaultPlanTimings,
  duePlanStep,
  nextPlanWeek,
  planTimes,
  type PlanStatus,
  weekHasBegun,
  type PlanStep,
  type PlanTimings,
} from './plans/plan-times';
export {
  comingPlanTimes,
  defaultStart,
  firstPlanWeek,
  startChoices,
  type StartChoice,
} from './plans/start';
export {
  averageWeeklyMinutes,
  goneDays,
  occurrenceId,
  weekOccurrences,
  type PlanTask,
  type Recurrence,
  type WeekInput,
  type WeekOccurrences,
} from './plans/week-occurrences';
export { expand } from './schedules/expand';
export {
  defaultTiming,
  frequencies,
  frequencyOf,
  frequencyRule,
  type Frequency,
} from './schedules/frequency';
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
  spreadFirstDueDates,
  type AwayPeriod,
  type Dueness,
  type Interval,
  type SinceLastDone,
} from './schedules/since-last-done';
export { changeStartDay, planWeek, type HouseholdCalendar, type PlanWeek } from './schedules/week';
export { intervalTimesPerYear, timesPerYear } from './schedules/yearly';
export { fairFractions, type PortionBasis } from './shares/fair-portion';
export {
  overlap,
  setShares,
  temporaryShareDays,
  weekShare,
  type ShareBasis,
  type ShareSettings,
  type TemporaryShare,
} from './shares/share';
export { defaultOnMiss, isTaskDuration, startRange, taskDuration } from './tasks/task';
