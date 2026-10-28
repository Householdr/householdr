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
  /**
   * For an e-mail that isn't mandatory, its one-click unsubscribe link, for the `List-Unsubscribe`
   * header (ADR-0014 §6, clarification).
   */
  unsubscribe?: string;
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
 * Draws numbers at random, from 0 up to 1: the system's generator in the app, fixed draws in
 * tests (ADR-0023 §3, TEST-2).
 */
export interface Random {
  next: () => number;
}

/**
 * Whether a flag of the registry is on (ADR-0015 §3, §4): from Flipt in the app, at the registry's
 * safe defaults without it, as a test sets it in tests (TEST-9). Flags are evaluated for everyone
 * until households exist in the app (ADR-0015 §3, clarification).
 */
export interface Flags {
  isOn: (flag: FlagKey) => boolean;
}

/** A browser's push subscription, as saved (ADR-0014 §7, clarification): where and for whom. */
export interface PushTarget {
  endpoint: string;
  /** The browser's P-256 public key and its 16-byte secret, in base64url (RFC 8291). */
  p256dh: string;
  auth: string;
}

/**
 * What a push carries, and nothing more (ADR-0014 §6, clarification): a title naming the household,
 * the notification's sentence, and the page of the app it opens.
 */
export interface PushContent {
  title: string;
  body: string;
  path: string;
}

/**
 * What the push service said: it took the push; the subscription is gone, so it is deleted
 * (ADR-0014 §7); or it failed, and may be tried again.
 */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Sends pushes: Web Push in the app, recorded in tests (ADR-0023 §3). */
export interface Push {
  send: (to: PushTarget, content: PushContent) => Promise<PushOutcome>;
}
