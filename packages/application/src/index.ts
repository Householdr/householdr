// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';
export { flags, type FlagKey } from './flags/registry';
export { defaultFlags, flagValues } from './flags/values';
// The apps open the database and the job queue here, to put them into their contexts (ADR-0023 §4);
// only use cases and `auth` query the one and queue jobs on the other.
export { connect, jobQueue, type Database, type JobQueue, type Jobs } from '@householdr/db';
