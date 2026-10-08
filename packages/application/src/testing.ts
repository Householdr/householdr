import { inHousehold, parentalConsents, type Database } from '@householdr/db';
import { defaultFlags } from './flags/values';
import type { FlagKey } from './flags/registry';
import type { Clock, Flags, LogFields, Logger, Mail, Mailer } from './ports';

/** A mailer that keeps what it is asked to send, for use-case tests (TEST-11). */
export function recordingMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}

/** One line a recording logger kept. */
export interface LogLine {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields: LogFields;
}

/** A logger that keeps its lines, for tests of what is logged (TEST-11). */
export function recordingLogger(): Logger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (event: string, fields: LogFields = {}) => {
      lines.push({ level, event, fields });
    };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

/** A clock that stands still until a test moves it on (TEST-11). */
export function settableClock(start: Temporal.Instant): Clock & {
  advance: (by: Temporal.DurationLike) => void;
} {
  let now = start;
  return {
    now: () => now,
    advance: (by) => {
      now = now.add(by);
    },
  };
}

/** Flags at their registry defaults, except those a test sets (TEST-9). */
export function settableFlags(values: Partial<Record<FlagKey, boolean>> = {}): Flags {
  return { isOn: (flag) => values[flag] ?? defaultFlags.isOn(flag) };
}

/**
 * The parental consents kept in household `householdId`, as stored (ADR-0010 §9): for tests of
 * what a page has kept, which can't read the database themselves (CODE-4).
 */
export function keptConsents(db: Database, householdId: string) {
  return inHousehold(db, householdId, (tx) =>
    tx
      .select({
        givenAt: parentalConsents.givenAt,
        text: parentalConsents.text,
        language: parentalConsents.language,
      })
      .from(parentalConsents),
  );
}
