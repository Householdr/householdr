import { describe, expect, it } from 'vitest';
import { recordingLogger, recordingMailer, settableClock } from './testing';

describe('recordingMailer', () => {
  it('keeps every mail it is asked to send, in order', async () => {
    const mailer = recordingMailer();
    const first = { to: 'a@example.org', subject: 'One', text: 'one', html: '<p>one</p>' };
    const second = { to: 'b@example.org', subject: 'Two', text: 'two', html: '<p>two</p>' };
    await mailer.send(first);
    await mailer.send(second);
    expect(mailer.sent).toEqual([first, second]);
  });
});

describe('recordingLogger', () => {
  it('keeps every line with its level, event and fields', () => {
    const logger = recordingLogger();
    logger.info('started');
    logger.warn('breach-check-unknown', { status: 503 });
    expect(logger.lines).toEqual([
      { level: 'info', event: 'started', fields: {} },
      { level: 'warn', event: 'breach-check-unknown', fields: { status: 503 } },
    ]);
  });
});

describe('settableClock', () => {
  it('tells the same time until it is moved on', () => {
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    expect(clock.now()).toEqual(clock.now());
    clock.advance({ minutes: 90 });
    expect(clock.now()).toEqual(Temporal.Instant.from('2026-10-08T09:30:00Z'));
  });
});
