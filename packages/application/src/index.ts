// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';
export { flags, type FlagKey } from './flags/registry';
export { defaultFlags, flagValues } from './flags/values';
// The apps open the database here, to put it into their contexts (ADR-0023 §4); only use cases and
// `auth` query it.
export { connect, type Database } from '@householdr/db';
