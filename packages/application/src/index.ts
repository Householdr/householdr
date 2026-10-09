// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';
export { flags, type FlagKey } from './flags/registry';
export { addAdult } from './households/add-adult';
export {
  createHousehold,
  newHousehold,
  offeredLanguages,
  type CreateHouseholdContext,
  type NewHouseholdField,
} from './households/create-household';
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
  membership,
  viewHousehold,
  type AccountHousehold,
  type HouseholdContext,
  type HouseholdMember,
  type HouseholdsContext,
} from './households/membership';
// The household member as permissions see them, which the web app's guard keeps per request.
export type { Member, Role } from '@householdr/domain';
export { defaultFlags, flagValues } from './flags/values';
// The apps open the database and the job queue here, to put them into their contexts (ADR-0023 §4);
// only use cases and `auth` query the one and queue jobs on the other.
export { connect, jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
