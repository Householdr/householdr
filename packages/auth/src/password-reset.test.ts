import { recordingLogger } from '@householdr/application/testing';
import {
  accountEmails,
  jobQueue,
  rateLimits,
  sessions,
  verifications,
  type JobQueue,
} from '@householdr/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareAccountEmail } from './account-emails';
import type { Cookie } from './cookies';
import {
  requestPasswordReset,
  resetLink,
  setNewPassword,
  type PasswordResetContext,
} from './password-reset';
import { currentSession } from './sessions';
import { signInWithPassword } from './sign-in';
import { createTestAccount, testSignInContext, totpCode, turnOnTestTwoFactor } from './testing';
import { signInWithCode } from './two-factor-sign-in';

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
const linkFor = async (accountId: string, email: string) => {
  await requestPasswordReset(context, { email });
  const [row] = await test.context.db
    .select({ id: accountEmails.id })
    .from(accountEmails)
    .where(and(eq(accountEmails.accountId, accountId), eq(accountEmails.kind, 'password-reset')));
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
    const token = await linkFor(account.id, account.email);
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
    const token = await linkFor(account.id, account.email);
    await setNewPassword(context, { token, password: newPassword });
    expect(await signIn(account.email, newPassword)).toMatchObject({ ok: true });
  });

  it('works once', async () => {
    const account = await newAccount();
    const token = await linkFor(account.id, account.email);
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

  it('can tell beforehand whether a link still works, and that it needs no code', async () => {
    const account = await newAccount();
    const token = await linkFor(account.id, account.email);
    const [link] = await test.context.db
      .select({ expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.value, account.id));
    if (!link) throw new Error('No link');
    const expiry = Temporal.Instant.fromEpochMilliseconds(link.expiresAt.getTime());
    const at = (now: Temporal.Instant) => ({ ...context, clock: { now: () => now } });
    expect(await resetLink(at(expiry.subtract({ seconds: 1 })), token)).toEqual({ code: false });
    expect(await resetLink(at(expiry), token)).toBeNull();
    expect(await resetLink(context, 'made-up')).toBeNull();
    expect(await resetLink(context, undefined)).toBeNull();
    await setNewPassword(context, { token, password: newPassword });
    expect(await resetLink(at(expiry.subtract({ seconds: 1 })), token)).toBeNull();
  });

  it('ignores a code without two-factor on', async () => {
    const account = await newAccount();
    const token = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token, password: newPassword, code: '000000' })).toEqual(
      { ok: true },
    );
  });

  it('wants 12 to 128 characters', async () => {
    const account = await newAccount();
    const token = await linkFor(account.id, account.email);
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
    const token = await linkFor(account.id, account.email);
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

describe('choosing a new password with two-factor on (ADR-0010 §8)', () => {
  /** A new account with a password and two-factor on: its ID, address, key and recovery codes. */
  const withTwoFactor = async () => {
    const account = await newAccount();
    const signedIn = await signIn(account.email, password);
    if (!signedIn.ok) throw new Error(signedIn.error);
    const [cookie] = signedIn.cookies;
    if (!cookie) throw new Error('No cookie');
    const headers = new Headers({ cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` });
    const { session } = await currentSession(test.context.auth, headers);
    if (!session) throw new Error('No session');
    const on = await turnOnTestTwoFactor(context, session, cookie);
    await test.context.db.delete(accountEmails).where(eq(accountEmails.accountId, account.id));
    return { ...account, key: on.key, recoveryCodes: on.recoveryCodes };
  };

  /** The app's code at the time the reset checks codes by: the context's clock. */
  const codeNow = (key: string) => totpCode(key, test.context.clock.now());
  const wrongCode = (key: string) =>
    String((Number(codeNow(key)) + 1) % 1_000_000).padStart(6, '0');

  /** The step a right password for `email` leaves, as request headers: it waits for a code. */
  const codeStep = async (email: string, typed = password) => {
    const result = await signIn(email, typed);
    if (result.ok || result.error !== 'needs-code') throw new Error('No code asked');
    const cookies = result.cookies.filter(({ value }: Cookie) => value !== '');
    return new Headers({
      cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    });
  };

  /** Whether `typed` is the account's password: with it, signing in asks for the code. */
  const passwordIs = async (email: string, typed: string) => {
    const result = await signIn(email, typed);
    return !result.ok && result.error === 'needs-code';
  };

  /** The count of the account's wrong codes, under which sign-in counts them. */
  const wrongCodes = async (accountId: string) => {
    const [row] = await test.context.db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(eq(rateLimits.key, context.counterKey('sign-in:account', accountId)));
    return row?.count ?? 0;
  };

  /** Whether signing in with the password and then `code` works. */
  const signInWith = async (email: string, code: { code: string } | { recoveryCode: string }) =>
    (await signInWithCode(context, await codeStep(email), code)).ok;

  it('says so beforehand, only for a link that works', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    expect(await resetLink(context, token)).toEqual({ code: true });
    expect(await resetLink(context, 'made-up')).toBeNull();
  });

  it('asks for a code, without changing anything or using the link', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    for (const code of [undefined, '', '  ']) {
      expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
        ok: false,
        error: 'needs-code',
      });
    }
    expect(await resetLink(context, token)).toEqual({ code: true });
    expect(await passwordIs(account.email, password)).toBe(true);
    expect(await wrongCodes(account.id)).toBe(0);
    expect(await waiting(account.id)).toEqual([]);
  });

  it('says a link doesn’t work before whether a code is needed', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    await setNewPassword(context, { token, password: newPassword, code: codeNow(account.key) });
    expect(await setNewPassword(context, { token, password: newPassword })).toEqual({
      ok: false,
      error: 'expired',
    });
    expect(await setNewPassword(context, { token: 'made-up', password: newPassword })).toEqual({
      ok: false,
      error: 'expired',
    });
  });

  it('refuses a wrong code and changes nothing, so the link still works', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    expect(
      await setNewPassword(context, { token, password: newPassword, code: wrongCode(account.key) }),
    ).toEqual({ ok: false, error: 'incorrect-code' });
    expect(
      await setNewPassword(context, { token, password: newPassword, code: 'aaaaa-aaaaa' }),
    ).toEqual({ ok: false, error: 'incorrect-code' });
    // Counted as at sign-in.
    expect(await wrongCodes(account.id)).toBe(2);
    expect(await resetLink(context, token)).toEqual({ code: true });
    expect(await passwordIs(account.email, password)).toBe(true);
    expect(await waiting(account.id)).toEqual([]);
    expect(
      await setNewPassword(context, { token, password: newPassword, code: codeNow(account.key) }),
    ).toEqual({ ok: true });
  });

  it('refuses what isn’t a code without counting it', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    for (const code of ['12345', 'abcdef', 'short', 'x'.repeat(40)]) {
      expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
        ok: false,
        error: 'incorrect-code',
      });
    }
    expect(await wrongCodes(account.id)).toBe(0);
  });

  it('sets it with the app’s code, ends every session, and forgets the wrong codes', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    await setNewPassword(context, { token, password: newPassword, code: wrongCode(account.key) });
    const code = codeNow(account.key);
    expect(
      await setNewPassword(context, {
        token,
        password: newPassword,
        code: ` ${code.slice(0, 3)} ${code.slice(3)} `,
      }),
    ).toEqual({ ok: true });
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.userId, account.id)),
    ).toEqual([]);
    expect(await waiting(account.id)).toEqual(['password-changed']);
    expect(await wrongCodes(account.id)).toBe(0);
    expect(await passwordIs(account.email, newPassword)).toBe(true);
    expect(await resetLink(context, token)).toBeNull();
  });

  it('takes a code from the period before or after, as sign-in does, and none older', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    const now = test.context.clock.now();
    const old = totpCode(account.key, now.subtract({ seconds: 60 }));
    expect(await setNewPassword(context, { token, password: newPassword, code: old })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
    const before = totpCode(account.key, now.subtract({ seconds: 30 }));
    expect(await setNewPassword(context, { token, password: newPassword, code: before })).toEqual({
      ok: true,
    });
  });

  it('accepts each code from the app once, here and at sign-in alike', async () => {
    const account = await withTwoFactor();
    const code = codeNow(account.key);
    const first = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token: first, password: newPassword, code })).toEqual({
      ok: true,
    });
    const second = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token: second, password, code })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
    expect(await resetLink(context, second)).toEqual({ code: true });
    // The library checks sign-in codes against the system's clock; on that clock, a code used to
    // sign in is refused here too.
    const system = { ...context, clock: { now: () => Temporal.Now.instant() } };
    const atSignIn = totpCode(account.key);
    const step = await codeStep(account.email, newPassword);
    expect(await signInWithCode(system, step, { code: atSignIn })).toMatchObject({ ok: true });
    expect(await setNewPassword(system, { token: second, password, code: atSignIn })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
  });

  it('sets it with a recovery code, however typed, which is used up as at sign-in', async () => {
    const account = await withTwoFactor();
    const [code = '', other = ''] = account.recoveryCodes;
    const first = await linkFor(account.id, account.email);
    expect(
      await setNewPassword(context, {
        token: first,
        password,
        code: code.replace('-', '').toUpperCase(),
      }),
    ).toEqual({ ok: true });
    // Used up: neither another reset nor signing in takes it again; the others still work.
    const second = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token: second, password, code })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
    expect(await signInWith(account.email, { recoveryCode: code })).toBe(false);
    expect(await signInWith(account.email, { recoveryCode: other })).toBe(true);
    expect(
      await setNewPassword(context, {
        token: second,
        password,
        code: account.recoveryCodes[2] ?? '',
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a recovery code used at sign-in', async () => {
    const account = await withTwoFactor();
    const [code = ''] = account.recoveryCodes;
    expect(await signInWith(account.email, { recoveryCode: code })).toBe(true);
    const token = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
  });

  it('checks the password first, so a refused one uses up no code', async () => {
    const account = await withTwoFactor();
    const [code = ''] = account.recoveryCodes;
    const token = await linkFor(account.id, account.email);
    expect(await setNewPassword(context, { token, password: 'too short', code })).toEqual({
      ok: false,
      error: 'too-short',
    });
    breach = 'breached';
    expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
      ok: false,
      error: 'breached',
    });
    breach = 'not-breached';
    expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
      ok: true,
    });
  });

  it('counts wrong codes with sign-in’s, and turns attempts away unchecked during a wait', async () => {
    const account = await withTwoFactor();
    const [code = ''] = account.recoveryCodes;
    const token = await linkFor(account.id, account.email);
    // Three wrong codes at sign-in and three here make six: one past the five free ones.
    const step = await codeStep(account.email);
    for (let i = 0; i < 3; i++) {
      expect(await signInWithCode(context, step, { recoveryCode: 'aaaaa-aaaaa' })).toMatchObject({
        error: 'incorrect',
      });
    }
    for (let i = 0; i < 3; i++) {
      expect(
        await setNewPassword(context, { token, password: newPassword, code: 'bbbbb-bbbbb' }),
      ).toEqual({ ok: false, error: 'incorrect-code' });
    }
    const until = test.context.clock.now().add({ seconds: 1 });
    // Even the right code is turned away, and isn't used up or counted.
    expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
      ok: false,
      error: 'wait',
      until,
    });
    expect(await wrongCodes(account.id)).toBe(6);
    expect(await signInWith(account.email, { recoveryCode: code })).toBe(false);
    test.context.clock.advance({ seconds: 1 });
    expect(await setNewPassword(context, { token, password: newPassword, code })).toEqual({
      ok: true,
    });
    // Resetting the password forgets them.
    expect(await wrongCodes(account.id)).toBe(0);
  });

  it('makes sign-in wait after wrong codes here', async () => {
    const account = await withTwoFactor();
    const token = await linkFor(account.id, account.email);
    for (let i = 0; i < 6; i++) {
      await setNewPassword(context, { token, password: newPassword, code: wrongCode(account.key) });
    }
    expect(
      await signInWithCode(context, await codeStep(account.email), {
        recoveryCode: account.recoveryCodes[0] ?? '',
      }),
    ).toMatchObject({ ok: false, error: 'wait' });
  });
});
