// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';
export { flags, type FlagKey } from './flags/registry';
export { householdActivity, type ActivityEntry } from './households/activity';
export {
  addAbsence,
  addAwayPeriod,
  removeAbsence,
  removeAwayPeriod,
  viewAvailability,
  type AbsenceField,
  type AbsenceView,
  type HouseholdAway,
  type MemberAvailability,
} from './availability/absences';
export { addAdult } from './households/add-adult';
export {
  changeHouseholdSettings,
  householdSettings,
  type HouseholdSettings,
  type SettingsField,
} from './households/settings';
export {
  createHousehold,
  newHousehold,
  offeredLanguages,
  type CreateHouseholdContext,
  type NewHouseholdField,
} from './households/create-household';
export {
  accountHouseholdList,
  membership,
  viewHousehold,
  type AccountHousehold,
  type HouseholdContext,
  type HouseholdMember,
  type HouseholdsContext,
} from './households/membership';
export { draftPlan } from './plans/draft-plan';
export { queueDuePlanSteps, type ScheduleContext } from './plans/plan-schedule';
export type { PlanContext } from './plans/planning';
export { publishPlan } from './plans/publish-plan';
export {
  viewPlan,
  type MemberPlan,
  type PlannedAssignment,
  type UnassignedOccurrence,
  type WeekPlan,
} from './plans/view-plan';
export type { MemberShare, PlannedShare } from './shares/member-share';
export { changeShare, householdShares, type ShareChange } from './shares/shares';
export {
  addTemporaryShare,
  removeTemporaryShare,
  type TemporaryShareField,
  type TemporaryShareInput,
} from './shares/temporary-shares';
export { addTask, type NewTaskField } from './tasks/add-task';
export { listTasks, type TaskSummary } from './tasks/list-tasks';
// The household member as permissions see them, which the web app's guard keeps per request.
export type { Member, Role } from '@householdr/domain';
export { defaultFlags, flagValues } from './flags/values';
// The apps open the database and the job queue here, to put them into their contexts (ADR-0023 §4);
// only use cases and `auth` query the one and queue jobs on the other.
export { connect, jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
