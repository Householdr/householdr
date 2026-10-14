import {
  addTask,
  createHousehold,
  draftPlan,
  membership,
  publishPlan,
  type Database,
  type PreparedEmail,
} from '@householdr/application';
import { recordingMailer, settableClock, settableFlags } from '@householdr/application/testing';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workQueues } from './index';
import { deliverMorningEmail, morningEmail } from './morning-emails';

// A member's morning e-mail, from the tick to the mailer (ADR-0014 §5–§7, clarifications), on a
// real database and queue (TEST-11), behind its flag (CODE-20). Invented households and addresses
// (TEST-8).

let test: Awaited<ReturnType<typeof testSignInContext>>;
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const origin = 'https://householdr.example.org';
const week = '2026-10-12';
/** Friday 9 October 2026, 07:30 in Brussels, as the default quiet hours end. */
const friday = Temporal.Instant.from('2026-10-09T05:30:00Z');

/**
 * Ash Lane, started from the week of 12 October 2026, whose head Robin has no push. On Thursday 8
 * October at 10:00 in Brussels, the scheduler drafts and publishes that week, with the dishes for
 * Robin to do.
 */
const household = async (db: Database, clock: ReturnType<typeof settableClock>) => {
  const email = `robin-${crypto.randomUUID()}@example.org`;
  const account = await createTestAccount(test.context.auth, {
    email,
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  const householdId = created.householdId;
  await startTestHousehold(db, householdId, week);
  const member = await membership({ db }, account, householdId);
  if (!member) throw new Error('Not a member');
  // Robin signs in with two factors, as a head must to add a task (ADR-0010 §3).
  const added = await addTask(
    { db, clock, householdId, member: { ...member, twoFactor: true } },
    { name: 'Dishes', duration: 20, frequency: 'daily', start: '2026-10-08', onMiss: 'roll over' },
  );
  const scheduler = { db, clock, householdId, member: 'scheduler' as const };
  if (!added.ok) throw new Error('No task');
  await draftPlan(scheduler, { week });
  await publishPlan(scheduler, { week });
  return { householdId, member: member.id, email };
};

const days = { first: Temporal.PlainDate.from(week), last: Temporal.PlainDate.from('2026-10-18') };
const prepared: PreparedEmail = {
  to: 'robin@example.org',
  culture: 'en-BE',
  household: 'Ash Lane',
  day: Temporal.PlainDate.from('2026-10-09'),
  notifications: [
    { kind: 'plan.drafted', week: days },
    { kind: 'plan.published', week: days },
  ],
  taken: ['n-1', 'n-2'],
};

describe('morningEmail (ADR-0014 §5–§6, clarifications)', () => {
  it('names the household and the day, says each notification as its list does, and links to it', () => {
    const { to, subject, text } = morningEmail(prepared, 'h-1', origin);
    expect(to).toBe('robin@example.org');
    expect(subject).toBe('Ash Lane: your notifications for Friday, 9 October 2026');
    expect(text).toBe(
      [
        'New for you in Ash Lane:',
        [
          '- The draft plan for 12–18 October 2026 is ready for you to check.',
          '- Your plan for 12–18 October 2026 is published.',
        ].join('\n'),
        `See all your notifications from this household:\n${origin}/households/h-1/notifications`,
        'You get this e-mail because you chose e-mail for these notifications, or because push notifications don’t reach you.',
        `Choose how you get notifications:\n${origin}/notification-settings`,
      ].join('\n\n'),
    );
  });

  it('has an accessible HTML part with a list, and nothing that tracks', () => {
    const { html } = morningEmail(prepared, 'h-1', origin);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      '<ul><li>The draft plan for 12–18 October 2026 is ready for you to check.</li><li>Your plan for 12–18 October 2026 is published.</li></ul>',
    );
    expect(html).toContain(
      `<a href="${origin}/households/h-1/notifications">See all your notifications from this household</a>`,
    );
    expect(html).not.toMatch(/<img|<script|style=/);
  });

  it('writes the household’s name as plain text, cut to 50 characters (ADR-0017 §5)', () => {
    const name = `<b>Ash</b> & Lane ${'x'.repeat(60)}`;
    const { subject, html } = morningEmail({ ...prepared, household: name }, 'h-1', origin);
    const shown = `${name.slice(0, 49)}…`;
    expect(subject.startsWith(`${shown}:`)).toBe(true);
    expect(html).toContain('&lt;b&gt;Ash&lt;/b&gt; &amp; Lane');
    expect(html).not.toContain('<b>');
  });

  it('writes the day with the conventions of the account’s country', () => {
    const { subject } = morningEmail({ ...prepared, culture: 'en-US' }, 'h-1', origin);
    expect(subject).toBe('Ash Lane: your notifications for Friday, October 9, 2026');
  });
});

describe('the morning e-mails’ jobs (ADR-0014 §5, §7)', () => {
  it('send a member’s e-mail from the tick as their quiet hours end, once', async () => {
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    const mailer = recordingMailer();
    const context = {
      ...test.context,
      clock,
      mailer,
      push: null,
      origin,
      flags: settableFlags({ 'morning-email': true }),
    };
    const { householdId, email } = await household(context.db, clock);
    clock.advance(clock.now().until(friday));
    const queue = await workQueues(context);
    try {
      await queue.send('email-tick', {});
      await expect.poll(() => mailer.sent.length, { timeout: 10_000 }).toBe(1);
      const [sent] = mailer.sent;
      expect(sent?.to).toBe(email);
      expect(sent?.text).toContain('- Your plan for 12–18 October 2026 is published.');
      expect(sent?.text).toContain(`${origin}/households/${householdId}/notifications`);
      // A tick again sends nothing more.
      await queue.send('email-tick', {});
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(mailer.sent).toHaveLength(1);
    } finally {
      await queue.stop({ graceful: false });
    }
  }, 30_000);

  it('give a failed e-mail’s notifications back, for a later one', async () => {
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    const flags = settableFlags({ 'morning-email': true });
    const { householdId, member } = await household(test.context.db, clock);
    clock.advance(clock.now().until(friday));
    const job = { household: householdId, member };
    const failing = {
      send: () => Promise.reject(new Error('The SMTP server is down.')),
    };
    const base = { db: test.context.db, clock, flags, push: null, origin };
    await expect(deliverMorningEmail({ ...base, mailer: failing }, job)).rejects.toThrow(
      'The SMTP server is down.',
    );
    const mailer = recordingMailer();
    await deliverMorningEmail({ ...base, mailer }, job);
    expect(mailer.sent).toEqual([]);
    clock.advance({ minutes: 5 });
    await deliverMorningEmail({ ...base, mailer }, job);
    expect(mailer.sent).toHaveLength(1);
  });
});
