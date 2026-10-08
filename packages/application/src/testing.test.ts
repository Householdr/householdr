import { describe, expect, it } from 'vitest';
import { recordingMailer } from './testing';

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
