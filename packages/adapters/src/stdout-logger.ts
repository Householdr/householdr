import type { LogFields, Logger } from '@householdr/application';

const secretKey = /password|passkey|token|secret|code|session|cookie|authorization|e-?mail/i;
const emailAddress = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

/**
 * Keeps a log line clear of what must never be logged (ADR-0017 §7, SEC-3): a field whose name
 * suggests a secret or an e-mail address is redacted, and any e-mail address in a value or an
 * error message is replaced. A second line of defence; lines should name accounts by ID anyway.
 */
export function scrub(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      secretKey.test(key) ? '[redacted]' : typeof value === 'string' ? withoutEmail(value) : value,
    ]),
  );
}

function withoutEmail(text: string) {
  return text.replace(emailAddress, '[e-mail]');
}

/**
 * The logger of the app and the worker: one JSON object per line on stdout (ADR-0008 §13), with
 * the time, the level, the event and its scrubbed fields.
 */
export function stdoutLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const at =
    (level: 'info' | 'warn' | 'error') =>
    (event: string, fields: LogFields = {}, error?: unknown) => {
      const failure =
        error instanceof Error
          ? { error: error.name, message: withoutEmail(error.message) }
          : error === undefined
            ? {}
            : { error: 'unknown' };
      // The line's own keys come last, so no field can stand in for them.
      write(
        JSON.stringify({ ...scrub(fields), ...failure, time: now().toISOString(), level, event }),
      );
    };
  return { info: at('info'), warn: at('warn'), error: at('error') };
}
