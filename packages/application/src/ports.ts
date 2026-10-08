import type { FlagKey } from './flags/registry';

/**
 * An e-mail to one person (ADR-0014 §6): a plain-text part and an accessible HTML part, written in
 * the recipient's culture. Who it comes from is the mailer's setting.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends e-mail: over SMTP in the app, recorded in tests (ADR-0023 §3). */
export interface Mailer {
  send: (mail: Mail) => Promise<void>;
}

/** What a log line may carry: plain values only, so no object is logged whole by accident. */
export type LogFields = Record<string, string | number | boolean | null>;

/**
 * Writes operational log lines (ADR-0008 §13): to stdout in the app, recorded in tests. Lines
 * name an event and identify accounts by ID, never by e-mail address (ADR-0017 §7, SEC-3).
 */
export interface Logger {
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields, error?: unknown) => void;
}

/** Tells the time: the system's clock in the app, one tests set (ADR-0023 §3). */
export interface Clock {
  now: () => Temporal.Instant;
}

/**
 * Whether a flag of the registry is on (ADR-0015 §3, §4): from Flipt in the app, at the registry's
 * safe defaults without it, as a test sets it in tests (TEST-9). Flags are evaluated for everyone
 * until households exist in the app (ADR-0015 §3, clarification).
 */
export interface Flags {
  isOn: (flag: FlagKey) => boolean;
}
