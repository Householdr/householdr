// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer, Random } from './ports';
export { flags, type FlagKey } from './flags/registry';
export {
  householdActivity,
  type ActivityEntry,
  type SetBeforeStartNames,
} from './households/activity';
export { answerComparison } from './burdens/answer-comparison';
export { comparisonGame, type ComparedTask } from './burdens/comparison-game';
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
export { addChild, type NewChildProblem } from './households/add-child';
export { name as nameField } from './households/name';
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
export { startHousehold, startOptions } from './households/start-household';
export {
  acceptInvitation,
  invite,
  openInvitation,
  revokeInvitation,
  type InvitationContext,
  type OpenInvitation,
} from './households/invitations';
export {
  accountHouseholdList,
  mayRemoveAccountPasskey,
  mayTurnOffTwoFactor,
  membership,
  viewHousehold,
  type AccountHousehold,
  type HouseholdContext,
  type HouseholdMember,
  type HouseholdsContext,
} from './households/membership';
export { completeOccurrence } from './completions/complete-occurrence';
export { undoCompletion } from './completions/undo-completion';
export { householdBalances, type MemberBalance, type SettledWeek } from './ledger/balances';
export { settlePlanWeek } from './ledger/settle-plan-week';
export { closeDueOccurrences } from './plans/closing';
export { draftPlan } from './plans/draft-plan';
export { queueDuePlanSteps, type ScheduleContext } from './plans/plan-schedule';
export type { PlanContext } from './plans/planning';
export { publishPlan } from './plans/publish-plan';
export {
  viewPlan,
  type MemberPlan,
  type PlanCompletion,
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
export { addTask } from './tasks/add-task';
export { editTask } from './tasks/edit-task';
export { listTasks, type TaskSummary } from './tasks/list-tasks';
export { removeTask } from './tasks/remove-task';
export type { TaskField } from './tasks/task-fields';
export { taskToEdit, type EditableTask } from './tasks/task-to-edit';
// The household member as permissions see them, which the web app's guard keeps per request; why an
// occurrence went where it did, which the plan's page puts in words; and how fast balances even
// out, which the balances page does; and how long ago a day was, which pages say vaguely.
export type {
  Member,
  PastDay,
  Reason,
  RebalancePreset,
  Role,
  StartChoice,
  UnassignedCause,
} from '@householdr/domain';
export { defaultFlags, flagValues } from './flags/values';
// The apps open the database and the job queue here, to put them into their contexts (ADR-0023 §4);
// only use cases and `auth` query the one and queue jobs on the other.
export { connect, jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
