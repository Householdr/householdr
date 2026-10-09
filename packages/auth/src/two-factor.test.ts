import { randomBytes } from 'node:crypto';
import { createHousehold } from '@householdr/application';
import { recordingLogger } from '@householdr/application/testing';
import {
  accountEmails,
  accounts,
  jobQueue,
  sessions,
  twoFactors,
  type JobQueue,
} from '@householdr/db';
import { symmetricDecrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import type { Cookie } from './cookies';
import { currentSession, sessionCookie, type Session } from './sessions';
import { signInWithPassword } from './sign-in';
import {
  addTestPasskey,
  createTestAccount,
  testSignInContext,
  totpCode,
  turnOnTestTwoFactor,
} from './testing';
import {
  accountTwoFactor,
  finishTwoFactor,
  replaceRecoveryCodes,
  startTwoFactor,
  turnOffTwoFactor,
  type TwoFactorContext,
} from './two-factor';
import { signInWithCode } from './two-factor-sign-in';

// Turning two-factor on and off on the security page (ADR-0010 §2, §3, §6), and how its secrets
// are kept (ADR-0012 §4, ADR-0017 §7), on a real database (TEST-11).

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

const password = 'correct horse battery staple';
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const client = { address: '192.0.2.1', userAgent: firefoxOnLinux };
let next = 0;

/** Request headers carrying `cookies`, as the browser sends them back, from Firefox on Linux. */
const headersWith = (...cookies: Cookie[]) =>
  new Headers({
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    'user-agent': firefoxOnLinux,
  });

/** A new account with a password, signed in: its session, and the cookie that carries it. */
const signedIn = async () => {
  const email = `person-${String(++next)}@example.org`;
  await createTestAccount(test.context.auth, { email, password });
  const result = await signInWithPassword(test.context, { email, password }, client);
  if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
  const [cookie] = result.cookies;
  if (!cookie) throw new Error('No cookie');
  const { session } = await currentSession(test.context.auth, headersWith(cookie));
  if (!session) throw new Error('No session');
  return { session, cookie, email };
};

/** Makes the session's sign-in 11 minutes old, by the context's clock (ADR-0010 §6). */
const signedInLongAgo = async (session: Session) => {
  const at = new Date(context.clock.now().subtract({ minutes: 11 }).epochMilliseconds);
  await test.context.db.update(sessions).set({ createdAt: at }).where(eq(sessions.id, session.id));
};

/** The kinds of the account e-mails waiting for `accountId`. */
const waiting = async (accountId: string) =>
  (
    await test.context.db
      .select({ kind: accountEmails.kind })
      .from(accountEmails)
      .where(eq(accountEmails.accountId, accountId))
  ).map((row) => row.kind);

/** Signs in to `email` with the password and then `input`, a code or a recovery code. */
const signInWith = async (email: string, input: { code?: string; recoveryCode?: string }) => {
  const first = await signInWithPassword(test.context, { email, password }, client);
  if (first.ok || first.error !== 'needs-code') throw new Error('No code asked');
  return signInWithCode(test.context, headersWith(...first.cookies), input);
};

const twoFactorRow = async (accountId: string) => {
  const [row] = await test.context.db
    .select()
    .from(twoFactors)
    .where(eq(twoFactors.userId, accountId));
  return row;
};

describe('turning two-factor on (ADR-0010 §2)', () => {
  it('is offered to an account with a password, and nothing to one without', async () => {
    const person = await signedIn();
    expect(await accountTwoFactor(context, person.session)).toEqual({ on: false });
    const internal = await test.context.auth.$context;
    const passkeysOnly = await internal.internalAdapter.createUser(
      {
        name: 'Robin',
        email: `person-${String(++next)}@example.org`,
        emailVerified: true,
        culture: 'en-BE',
      },
      { method: 'passkey' },
    );
    const { id } = await internal.internalAdapter.createSession(passkeysOnly.id);
    const session = { id, accountId: passkeysOnly.id, culture: 'en-BE' };
    expect(await accountTwoFactor(context, session)).toBeNull();
    expect(await startTwoFactor(context, session)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('sets up an app with a QR code or a key, for the account’s e-mail address', async () => {
    const person = await signedIn();
    const started = await startTwoFactor(context, person.session);
    if (!started.ok) throw new Error(started.error);
    const { uri, key } = started.setup;
    expect(key).toMatch(/^[A-Z2-7]{52}$/);
    expect(uri).toBe(
      `otpauth://totp/Householdr:${encodeURIComponent(person.email)}?secret=${key}&issuer=Householdr&digits=6&period=30`,
    );
    // Not on until a code from the app is right.
    expect(await accountTwoFactor(context, person.session)).toEqual({ on: false });
  });

  it('needs a right code from the app to finish, and then shows ten recovery codes', async () => {
    const person = await signedIn();
    const started = await startTwoFactor(context, person.session);
    if (!started.ok) throw new Error(started.error);
    const headers = headersWith(person.cookie);
    const wrong = String((Number(totpCode(started.setup.key)) + 1) % 1_000_000).padStart(6, '0');
    for (const code of [wrong, '', 'one two', undefined]) {
      expect(await finishTwoFactor(context, person.session, headers, { code })).toEqual({
        ok: false,
        error: 'incorrect',
        setup: started.setup,
      });
    }
    expect(await accountTwoFactor(context, person.session)).toEqual({ on: false });
    expect(await waiting(person.session.accountId)).toEqual([]);

    const finished = await finishTwoFactor(context, person.session, headers, {
      code: totpCode(started.setup.key),
    });
    if (!finished.ok) throw new Error(finished.error);
    expect(finished.recoveryCodes).toHaveLength(10);
    for (const code of finished.recoveryCodes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(new Set(finished.recoveryCodes).size).toBe(10);
    expect(await accountTwoFactor(context, person.session)).toEqual({ on: true });
    expect(await waiting(person.session.accountId)).toEqual(['two-factor-on']);
  });

  it('replaces this session with a new one on the same device', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    expect(on.session.id).not.toBe(person.session.id);
    expect(on.cookie).toMatchObject({ name: sessionCookie, options: { httpOnly: true } });
    const rows = await test.context.db
      .select({ id: sessions.id, browser: sessions.browser, system: sessions.system })
      .from(sessions)
      .where(eq(sessions.userId, person.session.accountId));
    expect(rows).toEqual([{ id: on.session.id, browser: 'Firefox', system: 'Linux' }]);
  });

  it('asks to confirm it is you when the sign-in is over 10 minutes old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    await signedInLongAgo(person.session);
    expect(await startTwoFactor(context, person.session)).toEqual({
      ok: false,
      error: 'confirm',
    });
    const fresh = await signedIn();
    const started = await startTwoFactor(context, fresh.session);
    if (!started.ok) throw new Error(started.error);
    await signedInLongAgo(fresh.session);
    expect(
      await finishTwoFactor(context, fresh.session, headersWith(fresh.cookie), {
        code: totpCode(started.setup.key),
      }),
    ).toEqual({ ok: false, error: 'confirm' });
    expect(await accountTwoFactor(context, fresh.session)).toEqual({ on: false });
  });

  it('finishes only a setup that was started, and the latest one', async () => {
    const person = await signedIn();
    const headers = headersWith(person.cookie);
    expect(await finishTwoFactor(context, person.session, headers, { code: '123456' })).toEqual({
      ok: false,
      error: 'not-started',
    });
    const first = await startTwoFactor(context, person.session);
    const second = await startTwoFactor(context, person.session);
    if (!first.ok || !second.ok) throw new Error('Not started');
    expect(second.setup.key).not.toBe(first.setup.key);
    expect(
      await finishTwoFactor(context, person.session, headers, {
        code: totpCode(first.setup.key),
      }),
    ).toMatchObject({ ok: false, error: 'incorrect' });
    // Once on, it isn't started again.
    await turnOnTestTwoFactor(context, person.session, person.cookie);
  });

  it('isn’t started again while it is on', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    expect(await startTwoFactor(context, on.session)).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('the secrets of two-factor (ADR-0012 §4, ADR-0017 §7)', () => {
  it('are kept encrypted with the current TOTP key, never as they are', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    const row = await twoFactorRow(person.session.accountId);
    if (!row) throw new Error('No row');
    expect(row.secret).toMatch(/^\$ba\$1\$[0-9a-f]+$/);
    expect(row.backupCodes).toMatch(/^\$ba\$1\$[0-9a-f]+$/);
    const raw = JSON.stringify(row);
    expect(raw).not.toContain(on.key);
    for (const code of on.recoveryCodes) expect(raw).not.toContain(code);
    // The TOTP key reads them, and the session secret doesn't.
    const key = test.totpKeys.keys.get(1) ?? '';
    const codes = await symmetricDecrypt({ key, data: row.backupCodes.replace('$ba$1$', '') });
    expect(JSON.parse(codes)).toEqual(on.recoveryCodes);
    await expect(
      symmetricDecrypt({ key: test.secret, data: row.secret.replace('$ba$1$', '') }),
    ).rejects.toThrow();
  });

  it('stay readable when a new key version is made current, and new ones use it', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    const old = test.totpKeys.keys.get(1) ?? '';
    const rotated = {
      ...context,
      auth: createAuth({
        db: test.context.db,
        baseUrl: 'https://householdr.example.org',
        secret: test.secret,
        totpKeys: {
          current: 2,
          keys: new Map([
            [2, randomBytes(32).toString('base64')],
            [1, old],
          ]),
        },
      }),
    };
    // Sessions are still signed with the same secret, so nobody is signed out.
    expect((await currentSession(rotated.auth, headersWith(on.cookie))).session?.id).toBe(
      on.session.id,
    );
    const first = await signInWithPassword(rotated, { email: person.email, password }, client);
    if (first.ok || first.error !== 'needs-code') throw new Error('No code asked');
    expect(
      await signInWithCode(rotated, headersWith(...first.cookies), { code: totpCode(on.key) }),
    ).toMatchObject({ ok: true });
    expect(await replaceRecoveryCodes(rotated, on.session)).toMatchObject({ ok: true });
    expect((await twoFactorRow(person.session.accountId))?.backupCodes).toMatch(/^\$ba\$2\$/);
  });

  it('can’t be written by a process without the keys, such as the worker', async () => {
    const person = await signedIn();
    const keyless = {
      ...context,
      auth: createAuth({
        db: test.context.db,
        baseUrl: 'https://householdr.example.org',
        secret: test.secret,
      }),
    };
    await expect(startTwoFactor(keyless, person.session)).rejects.toThrow();
    expect(await twoFactorRow(person.session.accountId)).toBeUndefined();
  });
});

describe('turning two-factor off (ADR-0010 §2, §3)', () => {
  it('lets the password sign in on its own again, and e-mails the member', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    expect(await turnOffTwoFactor(context, on.session)).toEqual({ ok: true });
    expect(await accountTwoFactor(context, on.session)).toEqual({ on: false });
    expect(await twoFactorRow(person.session.accountId)).toBeUndefined();
    expect(await waiting(person.session.accountId)).toEqual(['two-factor-on', 'two-factor-off']);
    expect(
      await signInWithPassword(test.context, { email: person.email, password }, client),
    ).toMatchObject({ ok: true });
    // Already off: nothing changes, and nobody is e-mailed again.
    expect(await turnOffTwoFactor(context, on.session)).toEqual({ ok: true });
    expect(await waiting(person.session.accountId)).toHaveLength(2);
  });

  it('asks to confirm it is you when the sign-in is over 10 minutes old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    await signedInLongAgo(on.session);
    expect(await turnOffTwoFactor(context, on.session)).toEqual({ ok: false, error: 'confirm' });
    expect(await accountTwoFactor(context, on.session)).toEqual({ on: true });
  });

  it('refuses a head without a passkey, who must keep two factors (ADR-0010 §3)', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    const created = await createHousehold(
      {
        db: test.context.db,
        actor: { account: person.session.accountId, twoFactor: true },
        account: { id: person.session.accountId, managed: false, guardians: [] },
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
    expect(created.ok).toBe(true);
    expect(await turnOffTwoFactor(context, on.session)).toEqual({ ok: false, error: 'head' });
    expect(await accountTwoFactor(context, on.session)).toEqual({ on: true });
    expect(await waiting(person.session.accountId)).toEqual(['two-factor-on']);
    // With a passkey, the head keeps two factors without it.
    expect(await addTestPasskey(context, on.session, on.cookie, client)).toEqual({ ok: true });
    expect(await turnOffTwoFactor(context, on.session)).toEqual({ ok: true });
  });
});

describe('new recovery codes (ADR-0010 §2)', () => {
  it('replace the old ones, which stop working, and e-mail the member', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    const replaced = await replaceRecoveryCodes(context, on.session);
    if (!replaced.ok) throw new Error(replaced.error);
    expect(replaced.recoveryCodes).toHaveLength(10);
    expect(replaced.recoveryCodes).not.toContain(on.recoveryCodes[0]);
    expect(await waiting(person.session.accountId)).toEqual([
      'two-factor-on',
      'recovery-codes-changed',
    ]);
    expect(
      await signInWith(person.email, { recoveryCode: on.recoveryCodes[0] ?? '' }),
    ).toMatchObject({ ok: false, error: 'incorrect' });
    expect(
      await signInWith(person.email, { recoveryCode: replaced.recoveryCodes[0] ?? '' }),
    ).toMatchObject({ ok: true });
  });

  it('ask to confirm it is you when the sign-in is over 10 minutes old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    const on = await turnOnTestTwoFactor(context, person.session, person.cookie);
    await signedInLongAgo(on.session);
    expect(await replaceRecoveryCodes(context, on.session)).toEqual({
      ok: false,
      error: 'confirm',
    });
  });

  it('aren’t made while two-factor is off', async () => {
    const person = await signedIn();
    expect(await replaceRecoveryCodes(context, person.session)).toEqual({
      ok: false,
      error: 'off',
    });
    const [account] = await test.context.db
      .select({ on: accounts.twoFactorEnabled })
      .from(accounts)
      .where(eq(accounts.id, person.session.accountId));
    expect(account?.on).toBe(false);
  });
});
