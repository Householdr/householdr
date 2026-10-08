// Use cases: authorise, validate, transact, emit events, return a result (ADR-0023).
export type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';
export { flags, type FlagKey } from './flags/registry';
export { defaultFlags, flagValues } from './flags/values';
