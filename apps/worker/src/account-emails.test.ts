import { recordingMailer } from '@householdr/application/testing';
import {
  createTestAccount,
  testSignInContext,
  waitingAccountEmail,
} from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverAccountEmail, written, type DeliveryContext } from './account-emails';
import { workQueues } from './index';

// Account e-mails from the queue to the mailer (ADR-0014 §6, §7), on a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: DeliveryContext & { mailer: ReturnType<typeof recordingMailer> };
beforeAll(async () => {
  test = await testSignInContext();
  context = { ...test.context, mailer: recordingMailer() };
});
afterAll(() => test.close());

let next = 0;
const newAccount = async () => {
  const email = `person-${String(++next)}@example.org`;
  const id = await createTestAccount(test.context.auth, {
    email,
    password: 'correct horse battery staple',
  });
  return { id, email };
};

describe('the password reset e-mail (ADR-0010 §8, ADR-0014 §6)', () => {
  const email = {
    kind: 'password-reset' as const,
    to: 'robin@example.org',
    link: 'https://householdr.example.org/reset-password/a-token?x=1&y=<2>',
  };

  it('says what was asked and how long the link works, as plain text', () => {
    const { to, subject, text } = written(email);
    expect(to).toBe('robin@example.org');
    expect(subject).toBe('Choose a new password for Householdr');
    expect(text).toBe(
      [
        'Someone asked to reset the password of your Householdr account.',
        `Choose a new password:\n${email.link}`,
        'The link works once, within 30 minutes.',
        'Wasn’t it you? Then ignore this e-mail: your password stays as it is.',
      ].join('\n\n'),
    );
  });

  it('has an HTML part with its language, its link escaped, and nothing that tracks', () => {
    const { html } = written(email);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      '<a href="https://householdr.example.org/reset-password/a-token?x=1&amp;y=&lt;2&gt;">Choose a new password</a>',
    );
    expect(html).not.toMatch(/<img|<script|style=/);
  });
});

describe('delivering an account e-mail (ADR-0014 §7, clarification)', () => {
  it('sends it with a fresh link and deletes its row', async () => {
    const account = await newAccount();
    const id = await waitingAccountEmail(test.context.db, account.id);
    await deliverAccountEmail(context, id);
    const [mail] = context.mailer.sent.splice(0);
    expect(mail?.to).toBe(account.email);
    expect(mail?.text).toMatch(/https:\/\/householdr\.example\.org\/reset-password\/[\w-]+/);
    // Delivered again, as after a retry, there is nothing left to send.
    await deliverAccountEmail(context, id);
    expect(context.mailer.sent).toEqual([]);
  });

  it('keeps the row when sending fails, for the job to try again', async () => {
    const account = await newAccount();
    const id = await waitingAccountEmail(test.context.db, account.id);
    const failing = {
      ...context,
      mailer: { send: () => Promise.reject(new Error('The SMTP server is away.')) },
    };
    await expect(deliverAccountEmail(failing, id)).rejects.toThrow('away');
    await deliverAccountEmail(context, id);
    expect(context.mailer.sent.splice(0).map((mail) => mail.to)).toEqual([account.email]);
  });

  it('is what the worker does with a queued job', async () => {
    const account = await newAccount();
    const queue = await workQueues(context);
    try {
      await waitingAccountEmail(test.context.db, account.id, queue);
      await expect
        .poll(() => context.mailer.sent.map((mail) => mail.to), { timeout: 10_000 })
        .toEqual([account.email]);
    } finally {
      await queue.stop({ graceful: false });
      context.mailer.sent.splice(0);
    }
  });
});
