import { accountEmails, verifications } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountEmailSent, prepareAccountEmail } from './account-emails';
import { createTestAccount, testSignInContext, waitingAccountEmail } from './testing';

// Account e-mails as the worker prepares them (ADR-0014 §7, clarification), on a real database
// (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
beforeAll(async () => {
  test = await testSignInContext();
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

/** A password reset e-mail waiting to be sent to `accountId`. */
const waiting = (accountId: string) => waitingAccountEmail(test.context.db, accountId);

const prepare = async (id: string) => {
  const email = await prepareAccountEmail(test.context, id);
  if (!email) throw new Error('Nothing to send');
  return { ...email, token: email.link.split('/').at(-1) ?? '' };
};

/** Whether `token` still sets a new password. */
const resets = (token: string) =>
  test.context.auth.api
    .resetPassword({ body: { token, newPassword: 'a whole new password' } })
    .then(
      () => true,
      () => false,
    );

describe('preparing a password reset e-mail (ADR-0010 §8)', () => {
  it('addresses it to the account, with a link to the reset page', async () => {
    const account = await newAccount();
    const email = await prepare(await waiting(account.id));
    expect(email).toMatchObject({ kind: 'password-reset', to: account.email });
    expect(email.link).toMatch(/^https:\/\/householdr\.example\.org\/reset-password\/[\w-]{20,}$/);
  });

  it('makes a link that works once, for 30 minutes, and is stored only as a hash (SEC-7)', async () => {
    const account = await newAccount();
    const { token } = await prepare(await waiting(account.id));
    const [stored] = await test.context.db
      .select()
      .from(verifications)
      .where(eq(verifications.value, account.id));
    expect(stored?.purpose).toBe('password-reset');
    expect(stored?.identifier).not.toContain(token);
    const minutes = ((stored?.expiresAt.getTime() ?? 0) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(await resets(token)).toBe(true);
    expect(await resets(token)).toBe(false);
  });

  it('replaces the account’s older link, and nobody else’s', async () => {
    const account = await newAccount();
    const someoneElse = await newAccount();
    const theirs = await prepare(await waiting(someoneElse.id));
    const older = await prepare(await waiting(account.id));
    const newer = await prepare(await waiting(account.id));
    expect(await resets(older.token)).toBe(false);
    expect(await resets(newer.token)).toBe(true);
    expect(await resets(theirs.token)).toBe(true);
  });

  it('has nothing to send once the row is gone, sent or with its account', async () => {
    const account = await newAccount();
    const id = await waiting(account.id);
    await accountEmailSent(test.context, id);
    expect(await prepareAccountEmail(test.context, id)).toBeNull();
    expect(
      await test.context.db.select().from(accountEmails).where(eq(accountEmails.id, id)),
    ).toEqual([]);
  });
});
