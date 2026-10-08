import type { LogFields, Logger, Mail, Mailer } from './ports';

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
