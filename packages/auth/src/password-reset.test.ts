import { recordingLogger } from '@householdr/application/testing';
import {
  accountEmails,
  jobQueue,
  rateLimits,
  sessions,
  verifications,
  type JobQueue,
} from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareAccountEmail } from './account-emails';
import {
  requestPasswordReset,
  resetLinkWorks,
  setNewPassword,
  type PasswordResetContext,
} from './password-reset';
import { signInWithPassword } from './sign-in';
import { createTestAccount, testSignInContext } from './testing';

// Resetting a forgotten password (ADR-0010 §8), on a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: PasswordResetContext & { logger: ReturnType<typeof recordingLogger> };
let breach: 'breached' | 'not-breached' | 'unknown' = 'not-breached';

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = {
    ...test.context,
    queue,
    logger: recordingLogger(),
    checkBreach: () => Promise.resolve(breach),
  };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});
beforeEach(async () => {
  breach = 'not-breached';
  context.logger.lines.splice(0);
  await test.context.db.delete(rateLimits);
});

const password = 'correct horse battery staple';
const newPassword = 'a whole new password';
let next = 0;
const newAccount = async () => {
  const email = `person-${String(++next)}@example.org`;
  const id = await createTestAccount(test.context.auth, { email, password });
  return { id, email };
};

/** The kinds of the account e-mails waiting for `accountId`. */
const waiting = async (accountId: string) =>
  (
    await test.context.db
      .select({ kind: accountEmails.kind })
      .from(accountEmails)
      .where(eq(accountEmails.accountId, accountId))
  ).map((row) => row.kind);

/** Asks for a link for `email` and returns its token, as the worker would send it. */
const resetLink = async (accountId: string, email: string) => {
  await requestPasswordReset(context, { email });
  const [row] = await test.context.db
    .select({ id: accountEmails.id })
    .from(accountEmails)
    .where(eq(accountEmails.accountId, accountId));
  const prepared = await prepareAccountEmail(test.context, row?.id ?? '');
  if (prepared?.kind !== 'password-reset') throw new Error('No link');
  await test.context.db.delete(accountEmails).where(eq(accountEmails.accountId, accountId));
  return prepared.link.split('/').at(-1) ?? '';
};

const signIn = (email: string, typed: string) =>
  signInWithPassword(
    context,
    { email, password: typed },
    { address: '192.0.2.1', userAgent: null },
  );

describe('asking for a reset link (ADR-0010 §8)', () => {
  it('queues a reset e-mail for an address with an account', async () => {
    const account = await newAccount();
    expect(
      await requestPasswordReset(context, { email: ` ${account.email.toUpperCase()}` }),
    ).toEqual({ ok: true });
    expect(await waiting(account.id)).toEqual(['password-reset']);
  });

  it('answers the same for an address without one, and queues nothing', async () => {
    const before = await test.context.db.select().from(accountEmails);
    expect(await requestPasswordReset(context, { email: 'nobody@example.org' })).toEqual({
      ok: true,
    });
    expect(await test.context.db.select().from(accountEmails)).toEqual(before);
  });

  it('sends at most 3 an hour to one address, and still answers the same (ADR-0017 §5)', async () => {
    const account = await newAccount();
    for (let i = 0; i < 5; i++) {
      expect(await requestPasswordReset(context, { email: account.email })).toEqual({ ok: true });
    }
    expect(await waiting(account.id)).toEqual([
      'password-reset',
      'password-reset',
      'password-reset',
    ]);
    test.context.clock.advance({ hours: 1 });
    await requestPasswordReset(context, { email: account.email });
    expect(await waiting(account.id)).toHaveLength(4);
  });

  it('turns away what isn’t an e-mail address', async () => {
    expect(await requestPasswordReset(context, { email: 'robin' })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});

describe('choosing a new password (ADR-0010 §2, §8)', () => {
  it('sets it, ends every session, and queues the notice', async () => {
    const account = await newAccount();
    expect(await signIn(account.email, password)).toMatchObject({ ok: true });
    const token = await resetLink(account.id, account.email);
    expect(await setNewPassword(context, { token, password: newPassword })).toEqual({ ok: true });
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.userId, account.id)),
    ).toEqual([]);
    expect(await waiting(account.id)).toEqual(['password-changed']);
    expect(await signIn(account.email, password)).toMatchObject({ error: 'incorrect' });
    expect(await signIn(account.email, newPassword)).toMatchObject({ ok: true });
  });

  it('forgets the failed sign-ins of the address', async () => {
    const account = await newAccount();
    for (let i = 0; i < 6; i++) await signIn(account.email, 'wrong');
    expect(await signIn(account.email, password)).toMatchObject({ error: 'wait' });
    const token = await resetLink(account.id, account.email);
    await setNewPassword(context, { token, password: newPassword });
    expect(await signIn(account.email, newPassword)).toMatchObject({ ok: true });
  });

  it('works once', async () => {
    const account = await newAccount();
    const token = await resetLink(account.id, account.email);
    await setNewPassword(context, { token, password: newPassword });
    expect(await setNewPassword(context, { token, password: 'yet another password' })).toEqual({
      ok: false,
      error: 'expired',
    });
    expect(await setNewPassword(context, { token: 'made-up', password: newPassword })).toEqual({
      ok: false,
      error: 'expired',
    });
  });

  it('can tell beforehand whether a link still works', async () => {
    const account = await newAccount();
    const token = await resetLink(account.id, account.email);
    const [link] = await test.context.db
      .select({ expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.value, account.id));
    if (!link) throw new Error('No link');
    const expiry = Temporal.Instant.fromEpochMilliseconds(link.expiresAt.getTime());
    const at = (now: Temporal.Instant) => ({ ...context, clock: { now: () => now } });
    expect(await resetLinkWorks(at(expiry.subtract({ seconds: 1 })), token)).toBe(true);
    expect(await resetLinkWorks(at(expiry), token)).toBe(false);
    expect(await resetLinkWorks(context, 'made-up')).toBe(false);
    expect(await resetLinkWorks(context, undefined)).toBe(false);
    await setNewPassword(context, { token, password: newPassword });
    expect(await resetLinkWorks(at(expiry.subtract({ seconds: 1 })), token)).toBe(false);
  });

  it('wants 12 to 128 characters', async () => {
    const account = await newAccount();
    const token = await resetLink(account.id, account.email);
    expect(await setNewPassword(context, { token, password: 'too short' })).toEqual({
      ok: false,
      error: 'too-short',
    });
    expect(await setNewPassword(context, { token, password: 'x'.repeat(129) })).toEqual({
      ok: false,
      error: 'too-long',
    });
    // The link still works after a password it refused.
    expect(await setNewPassword(context, { token, password: 'x'.repeat(128) })).toEqual({
      ok: true,
    });
  });

  it('refuses a breached password, and accepts one it couldn’t check, logging only that', async () => {
    const account = await newAccount();
    const token = await resetLink(account.id, account.email);
    breach = 'breached';
    expect(await setNewPassword(context, { token, password: newPassword })).toEqual({
      ok: false,
      error: 'breached',
    });
    breach = 'unknown';
    expect(await setNewPassword(context, { token, password: newPassword })).toEqual({ ok: true });
    expect(context.logger.lines).toEqual([
      { level: 'warn', event: 'password.breach-check-missed', fields: {} },
    ]);
  });
});
