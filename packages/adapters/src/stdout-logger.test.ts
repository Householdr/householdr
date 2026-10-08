import { describe, expect, it } from 'vitest';
import { scrub, stdoutLogger } from './stdout-logger';

const at = new Date('2026-10-08T07:40:00.000Z');

function logged() {
  const lines: unknown[] = [];
  const logger = stdoutLogger(
    (line) => lines.push(JSON.parse(line)),
    () => at,
  );
  return { lines, logger };
}

describe('scrub (ADR-0017 §7, SEC-3)', () => {
  it.each([
    'password',
    'newPassword',
    'token',
    'sessionId',
    'resetCode',
    'email',
    'eMail',
    'secret',
  ])('redacts a field named %s', (key) => {
    expect(scrub({ [key]: 'value' })).toEqual({ [key]: '[redacted]' });
  });

  it('replaces e-mail addresses inside other values', () => {
    expect(scrub({ detail: 'Key (email)=(robin@example.org) already exists' })).toEqual({
      detail: 'Key (email)=([e-mail]) already exists',
    });
  });

  it('keeps ids, numbers and flags as they are', () => {
    const fields = { account: '0b8e8a64-2f4e-4c1a-9a51-3c6f1c0d2a11', status: 503, retried: true };
    expect(scrub(fields)).toEqual(fields);
  });
});

describe('stdoutLogger (ADR-0008 §13)', () => {
  it('writes one JSON object per line, with the time, level and event', () => {
    const { lines, logger } = logged();
    logger.warn('breach-check-unknown', { status: 503 });
    expect(lines).toEqual([
      {
        time: '2026-10-08T07:40:00.000Z',
        level: 'warn',
        event: 'breach-check-unknown',
        status: 503,
      },
    ]);
  });

  it('scrubs the fields', () => {
    const { lines, logger } = logged();
    logger.info('signed-in', { email: 'robin@example.org', note: 'for kim@example.org' });
    expect(lines[0]).toMatchObject({ email: '[redacted]', note: 'for [e-mail]' });
  });

  it('logs an error by its name and its message, without e-mail addresses or a stack', () => {
    const { lines, logger } = logged();
    logger.error('send-failed', {}, new TypeError('No mailbox for robin@example.org'));
    expect(lines[0]).toEqual({
      time: '2026-10-08T07:40:00.000Z',
      level: 'error',
      event: 'send-failed',
      error: 'TypeError',
      message: 'No mailbox for [e-mail]',
    });
  });

  it('does not let a field stand in for the time, level or event', () => {
    const { lines, logger } = logged();
    logger.info('real', { event: 'forged', level: 'error', time: 'never' });
    expect(lines[0]).toMatchObject({ event: 'real', level: 'info', time: at.toISOString() });
  });
});
