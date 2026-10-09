import { recordingMailer } from '@householdr/application/testing';
import {
  createTestAccount,
  testSignInContext,
  waitingAccountEmail,
} from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverAccountEmail, written } from './account-emails';
import { workQueues, type WorkerContext } from './index';

// Account e-mails from the queue to the mailer (ADR-0014 §6, §7), on a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: WorkerContext & { mailer: ReturnType<typeof recordingMailer> };
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

describe('the sign-up e-mail (ADR-0010 §1, ADR-0014 §6)', () => {
  it('says what was asked and how long the link works', () => {
    const link = 'https://householdr.example.org/sign-up/a-token';
    const { to, subject, text, html } = written({ kind: 'sign-up', to: 'kim@example.org', link });
    expect(to).toBe('kim@example.org');
    expect(subject).toBe('Confirm your e-mail address for Householdr');
    expect(text).toBe(
      [
        'Someone asked to create a household on Householdr with this e-mail address.',
        `Confirm and continue:\n${link}`,
        'The link works for 30 minutes.',
        'Wasn’t it you? Then ignore this e-mail: nothing is created without the link.',
      ].join('\n\n'),
    );
    expect(html).toContain(`<a href="${link}">Confirm and continue</a>`);
  });
});

describe('the password-changed e-mail (ADR-0010 §8)', () => {
  it('says the password was changed and every device signed out, with no link', () => {
    const { subject, text, html } = written({ kind: 'password-changed', to: 'robin@example.org' });
    expect(subject).toBe('Your Householdr password was changed');
    expect(text).toContain('every device was signed out');
    expect(text).toContain('Secure your e-mail account first');
    expect(html).not.toContain('<a ');
  });
});

describe('the passkey e-mails (ADR-0010 §2, ADR-0014 §2)', () => {
  it('say a passkey was added or removed, and what to do if it wasn’t you, with no link', () => {
    const added = written({ kind: 'passkey-added', to: 'robin@example.org' });
    expect(added.subject).toBe('A passkey was added to your Householdr account');
    expect(added.text).toContain('remove the passkey and sign out all other devices');
    expect(added.html).not.toContain('<a ');
    const removed = written({ kind: 'passkey-removed', to: 'robin@example.org' });
    expect(removed.subject).toBe('A passkey was removed from your Householdr account');
    expect(removed.text).toContain('It no longer signs in.');
    expect(removed.html).not.toContain('<a ');
  });
});

describe('the two-factor e-mails (ADR-0010 §2, ADR-0014 §2)', () => {
  it('say what changed and what to do if it wasn’t you, with no link and no code', () => {
    const on = written({ kind: 'two-factor-on', to: 'robin@example.org' });
    expect(on.subject).toBe('Two-factor authentication was turned on for your Householdr account');
    expect(on.text).toContain('also asks for a code from your authenticator app');
    expect(on.text).toContain('turn two-factor authentication off');
    const off = written({ kind: 'two-factor-off', to: 'robin@example.org' });
    expect(off.subject).toBe(
      'Two-factor authentication was turned off for your Householdr account',
    );
    expect(off.text).toContain('Your password signs you in on its own again.');
    const codes = written({ kind: 'recovery-codes-changed', to: 'robin@example.org' });
    expect(codes.subject).toBe('New recovery codes were made for your Householdr account');
    expect(codes.text).toContain('The old ones no longer work.');
    for (const mail of [on, off, codes]) {
      expect(mail.html).not.toContain('<a ');
      expect(mail.text).not.toMatch(/[a-z0-9]{5}-[a-z0-9]{5}/);
    }
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

  it('sends a sign-up’s link to the address typed', async () => {
    const email = `new-${String(++next)}@example.org`;
    const { rows } = await test.context.db.$client.query<{ id: string }>(
      "insert into auth.account_emails (kind, email) values ('sign-up', $1) returning id",
      [email],
    );
    await deliverAccountEmail(context, rows[0]?.id ?? '');
    const [mail] = context.mailer.sent.splice(0);
    expect(mail?.to).toBe(email);
    expect(mail?.text).toMatch(/https:\/\/householdr\.example\.org\/sign-up\/[\w-]+/);
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

describe('deleting expired sign-up links (ADR-0012 §5, clarification)', () => {
  it('is what the worker does with the scheduled job', async () => {
    // Links that expired 8 and 6 days ago, by the test's clock.
    for (const days of [8, 6]) {
      const expiry = test.context.clock.now().subtract({ hours: days * 24 });
      await test.context.db.$client.query(
        "insert into auth.verifications (identifier, value, purpose, expires_at) values ($1, $2, 'sign-up', $3)",
        [`expired-${String(days)}`, `expired-${String(days)}@example.org`, expiry.toString()],
      );
    }
    const links = async () =>
      (
        await test.context.db.$client.query<{ value: string }>(
          "select value from auth.verifications where purpose = 'sign-up' and value like 'expired-%'",
        )
      ).rows.map((row) => row.value);
    const queue = await workQueues(context);
    try {
      await queue.send('expired-sign-up-links', {});
      await expect.poll(links, { timeout: 10_000 }).toEqual(['expired-6@example.org']);
    } finally {
      await queue.stop({ graceful: false });
    }
  });
});
