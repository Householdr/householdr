import { recordingLogger } from '@householdr/application/testing';
import { jobQueue, rateLimits, sessions, type JobQueue } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cookie } from './cookies';
import { confirmWithPassword, signedInRecently } from './passkeys';
import { signInWithPasskey, passkeyChallenge } from './passkey-sign-in';
import { requestPasswordReset, setNewPassword } from './password-reset';
import { currentSession, sessionCookie, type Session } from './sessions';
import { signInWithPassword } from './sign-in';
import {
  addTestPasskey,
  createTestAccount,
  testAuthenticator,
  testSignInContext,
  totpCode,
  turnOnTestTwoFactor,
} from './testing';
import type { TwoFactorContext } from './two-factor';
import { codeAwaited, signInWithCode } from './two-factor-sign-in';
import { accountEmailSent, prepareAccountEmail } from './account-emails';

// Signing in with a password and then a code (ADR-0010 §2), its waits (§2, clarification) and
// confirming it is you with both (§6), on a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: TwoFactorContext;

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = { ...test.context, queue, logger: recordingLogger() };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});
// Every test starts with no counts.
beforeEach(async () => {
  await test.context.db.delete(rateLimits);
});

const password = 'correct horse battery staple';
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const client = { address: '192.0.2.1', userAgent: firefoxOnLinux };
const origin = 'https://householdr.example.org';
let next = 0;

/** Request headers carrying `cookies`, as the browser sends them back, from Firefox on Linux. */
const headersWith = (...cookies: Cookie[]) =>
  new Headers({
    cookie: cookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
      .join('; '),
    'user-agent': firefoxOnLinux,
  });

/** The session `cookies` carry, if any. */
const sessionOf = async (cookies: Cookie[]) =>
  (await currentSession(test.context.auth, headersWith(...cookies))).session;

/** A new account with a password and two-factor on: its address, key and recovery codes. */
const withTwoFactor = async () => {
  const email = `person-${String(++next)}@example.org`;
  const accountId = await createTestAccount(test.context.auth, { email, password });
  const result = await signInWithPassword(test.context, { email, password }, client);
  if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
  const [cookie] = result.cookies;
  const session = cookie && (await sessionOf([cookie]));
  if (!cookie || !session) throw new Error('No session');
  const on = await turnOnTestTwoFactor(context, session, cookie);
  return { email, accountId, ...on };
};

/** The cookies of a right password for `email`, which leave a step that waits for a code. */
const passwordStep = async (email: string) => {
  const result = await signInWithPassword(test.context, { email, password }, client);
  if (result.ok || result.error !== 'needs-code') throw new Error('No code asked');
  return result.cookies;
};

/** A code for `key` that is wrong now. */
const wrongCode = (key: string) => String((Number(totpCode(key)) + 1) % 1_000_000).padStart(6, '0');

const later = (seconds: number) => test.context.clock.now().add({ seconds });

describe('signing in with a password and a code (ADR-0010 §2)', () => {
  it('starts no session after the password, only a step that waits for a code', async () => {
    const person = await withTwoFactor();
    await test.context.db.delete(sessions).where(eq(sessions.userId, person.accountId));
    const cookies = await passwordStep(person.email);
    const step = cookies.find(({ name }) => name === '__Host-householdr.two_factor');
    expect(step?.options).toMatchObject({
      path: '/',
      maxAge: 600,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    expect(cookies.filter(({ name, value }) => name === sessionCookie && value !== '')).toEqual([]);
    expect(await sessionOf(cookies)).toBeNull();
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.userId, person.accountId)),
    ).toEqual([]);
    expect(await codeAwaited(test.context, headersWith(...cookies))).toBe(true);
    expect(await codeAwaited(test.context, headersWith())).toBe(false);
  });

  it('signs in with the app’s code, on the device the password came from', async () => {
    const person = await withTwoFactor();
    const result = await signInWithCode(
      test.context,
      headersWith(...(await passwordStep(person.email))),
      { code: totpCode(person.key) },
    );
    if (!result.ok) throw new Error(result.error);
    const session = await sessionOf(result.cookies);
    expect(session?.accountId).toBe(person.accountId);
    const [row] = await test.context.db
      .select({ browser: sessions.browser, system: sessions.system })
      .from(sessions)
      .where(eq(sessions.id, session?.id ?? ''));
    expect(row).toEqual({ browser: 'Firefox', system: 'Linux' });
    // The step is used up.
    expect(result.cookies).toContainEqual(
      expect.objectContaining({ name: '__Host-householdr.two_factor', value: '' }),
    );
  });

  it('takes the code with spaces, as apps show it', async () => {
    const person = await withTwoFactor();
    const code = totpCode(person.key);
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        code: ` ${code.slice(0, 3)} ${code.slice(3)} `,
      }),
    ).toMatchObject({ ok: true });
  });

  it('refuses a wrong code, and what isn’t one without counting it', async () => {
    const person = await withTwoFactor();
    const headers = headersWith(...(await passwordStep(person.email)));
    for (const input of [{ code: '12345' }, { code: 'abcdef' }, {}, { recoveryCode: 'short' }]) {
      expect(await signInWithCode(test.context, headers, input)).toEqual({
        ok: false,
        error: 'incorrect',
      });
    }
    // The right password left counts of 0; nothing more was counted.
    for (const row of await test.context.db.select().from(rateLimits)) expect(row.count).toBe(0);
    expect(await signInWithCode(test.context, headers, { code: wrongCode(person.key) })).toEqual({
      ok: false,
      error: 'incorrect',
    });
    expect(await sessionOf([])).toBeNull();
  });

  it('accepts each code from the app once', async () => {
    const person = await withTwoFactor();
    const code = totpCode(person.key);
    const [first, second] = await Promise.all([
      signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), { code }),
      signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), { code }),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        code,
      }),
    ).toEqual({ ok: false, error: 'incorrect' });
    // The app's next code works.
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        code: totpCode(person.key, Temporal.Now.instant().add({ seconds: 30 })),
      }),
    ).toMatchObject({ ok: true });
  });

  it('signs in with a recovery code, however it is typed, and each works once', async () => {
    const person = await withTwoFactor();
    const [code = '', other = ''] = person.recoveryCodes;
    const typed = code.replace('-', '').toUpperCase();
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        recoveryCode: typed,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        recoveryCode: code,
      }),
    ).toEqual({ ok: false, error: 'incorrect' });
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        recoveryCode: other,
      }),
    ).toMatchObject({ ok: true });
  });

  it('says the step is over without one, or once it is used', async () => {
    const person = await withTwoFactor();
    expect(
      await signInWithCode(test.context, headersWith(), { code: totpCode(person.key) }),
    ).toEqual({ ok: false, error: 'expired' });
    const forged: Cookie = {
      name: '__Host-householdr.two_factor',
      value: '2fa-guess.x',
      options: { path: '/' },
    };
    expect(
      await signInWithCode(test.context, headersWith(forged), { code: totpCode(person.key) }),
    ).toEqual({ ok: false, error: 'expired' });
    const headers = headersWith(...(await passwordStep(person.email)));
    expect(
      await signInWithCode(test.context, headers, { recoveryCode: person.recoveryCodes[0] ?? '' }),
    ).toMatchObject({ ok: true });
    expect(
      await signInWithCode(test.context, headers, { recoveryCode: person.recoveryCodes[1] ?? '' }),
    ).toEqual({ ok: false, error: 'expired' });
  });

  it('checks the code of the step’s account, whoever else is signed in on the device', async () => {
    const person = await withTwoFactor();
    const other = await withTwoFactor();
    const headers = headersWith(other.cookie, ...(await passwordStep(person.email)));
    expect(await signInWithCode(test.context, headers, { code: totpCode(other.key) })).toEqual({
      ok: false,
      error: 'incorrect',
    });
    const result = await signInWithCode(test.context, headers, { code: totpCode(person.key) });
    if (!result.ok) throw new Error(result.error);
    expect((await sessionOf(result.cookies))?.accountId).toBe(person.accountId);
  });

  it('never asks a passkey for a code, since a passkey is two factors already', async () => {
    const person = await withTwoFactor();
    const authenticator = testAuthenticator();
    expect(
      await addTestPasskey(context, person.session, person.cookie, client, authenticator),
    ).toEqual({ ok: true });
    const { options, cookies } = await passkeyChallenge(test.context, headersWith());
    const response = authenticator.authenticate(
      options as Parameters<typeof authenticator.authenticate>[0],
      origin,
    );
    const result = await signInWithPasskey(test.context, headersWith(...cookies), { response });
    if (!result.ok) throw new Error(result.error);
    expect((await sessionOf(result.cookies))?.accountId).toBe(person.accountId);
  });
});

describe('the waits after wrong codes (ADR-0010 §2, clarification)', () => {
  it('start after 5 for an account, across steps, and turn attempts away unchecked', async () => {
    const person = await withTwoFactor();
    const first = headersWith(...(await passwordStep(person.email)));
    for (let i = 0; i < 5; i++) {
      expect(
        await signInWithCode(test.context, first, { code: wrongCode(person.key) }),
      ).toMatchObject({ error: 'incorrect' });
    }
    // The library allows 5 tries per step; the next needs the password again, and isn't counted.
    expect(await signInWithCode(test.context, first, { code: totpCode(person.key) })).toEqual({
      ok: false,
      error: 'expired',
    });
    const second = headersWith(...(await passwordStep(person.email)));
    expect(
      await signInWithCode(test.context, second, { code: wrongCode(person.key) }),
    ).toMatchObject({ error: 'incorrect' });
    // Even the right code is turned away during the wait.
    expect(await signInWithCode(test.context, second, { code: totpCode(person.key) })).toEqual({
      ok: false,
      error: 'wait',
      until: later(1),
    });
    test.context.clock.advance({ seconds: 1 });
    expect(
      await signInWithCode(test.context, second, { code: totpCode(person.key) }),
    ).toMatchObject({ ok: true });
  });

  it('count recovery codes with the app’s codes', async () => {
    const person = await withTwoFactor();
    for (let step = 0; step < 2; step++) {
      const headers = headersWith(...(await passwordStep(person.email)));
      for (let i = 0; i < 3; i++) {
        expect(
          await signInWithCode(test.context, headers, { recoveryCode: 'aaaaa-aaaaa' }),
        ).toMatchObject({ error: 'incorrect' });
      }
    }
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        recoveryCode: person.recoveryCodes[0] ?? '',
      }),
    ).toEqual({ ok: false, error: 'wait', until: later(1) });
  });

  it('start again from nothing once the account signs in, or its password is reset', async () => {
    const person = await withTwoFactor();
    const failFive = async () => {
      const headers = headersWith(...(await passwordStep(person.email)));
      for (let i = 0; i < 5; i++) {
        await signInWithCode(test.context, headers, { code: wrongCode(person.key) });
      }
    };
    await failFive();
    expect(
      await signInWithCode(test.context, headersWith(...(await passwordStep(person.email))), {
        recoveryCode: person.recoveryCodes[0] ?? '',
      }),
    ).toMatchObject({ ok: true });
    await failFive();
    await requestPasswordReset(context, { email: person.email });
    const [row] = await test.context.db.$client
      .query<{ id: string }>(
        "select id from auth.account_emails where account_id = $1 and kind = 'password-reset'",
        [person.accountId],
      )
      .then(({ rows }) => rows);
    const prepared = await prepareAccountEmail(test.context, row?.id ?? '');
    if (prepared?.kind !== 'password-reset') throw new Error('No reset link');
    await accountEmailSent(test.context, row?.id ?? '');
    const token = prepared.link.split('/').at(-1) ?? '';
    // With two-factor on, a new password needs a code too (ADR-0010 §8).
    const code = person.recoveryCodes[1] ?? '';
    expect(await setNewPassword(context, { token, password, code })).toEqual({ ok: true });
    const headers = headersWith(...(await passwordStep(person.email)));
    for (let i = 0; i < 5; i++) {
      expect(
        await signInWithCode(test.context, headers, { code: wrongCode(person.key) }),
      ).toMatchObject({ error: 'incorrect' });
    }
  });
});

describe('confirming it is you with two-factor on (ADR-0010 §6)', () => {
  /** The account, signed in with a password and a code 11 minutes ago. */
  const signedInLongAgo = async () => {
    const person = await withTwoFactor();
    const at = new Date(test.context.clock.now().subtract({ minutes: 11 }).epochMilliseconds);
    await test.context.db
      .update(sessions)
      .set({ createdAt: at })
      .where(eq(sessions.id, person.session.id));
    return person;
  };
  const confirm = (session: Session, input: { password?: string; code?: string }) =>
    confirmWithPassword(context, session, input, client);

  it('needs the password and a code from the app', async () => {
    const person = await signedInLongAgo();
    expect(await signedInRecently(context, person.session)).toBe(false);
    expect(await confirm(person.session, { password })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
    expect(await confirm(person.session, { password, code: wrongCode(person.key) })).toEqual({
      ok: false,
      error: 'incorrect-code',
    });
    expect(
      await confirm(person.session, { password: 'not the password', code: totpCode(person.key) }),
    ).toEqual({ ok: false, error: 'incorrect' });
    const confirmed = await confirm(person.session, { password, code: totpCode(person.key) });
    if (!confirmed.ok) throw new Error(confirmed.error);
    const session = await sessionOf(confirmed.cookies);
    if (!session) throw new Error('No session');
    expect(session.id).not.toBe(person.session.id);
    expect(await signedInRecently(context, session)).toBe(true);
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.id, person.session.id)),
    ).toEqual([]);
  });

  it('counts wrong codes as signing in does', async () => {
    const person = await signedInLongAgo();
    for (let i = 0; i < 6; i++) {
      expect(await confirm(person.session, { password, code: wrongCode(person.key) })).toEqual({
        ok: false,
        error: 'incorrect-code',
      });
    }
    expect(await confirm(person.session, { password, code: totpCode(person.key) })).toEqual({
      ok: false,
      error: 'wait',
      until: later(1),
    });
  });
});
