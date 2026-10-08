import { randomBytes } from 'node:crypto';
import { settableClock } from '@householdr/application/testing';
import { rateLimits, sessions, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import { counterKeys } from './counter-keys';
import { signInWithPassword, type SignInContext } from './sign-in';
import { createTestAccount } from './testing';

// Password sign-in and its waits (ADR-0010 §2, clarification), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
let context: SignInContext & { clock: ReturnType<typeof settableClock> };
let next = 0;
const password = 'correct horse battery staple';

beforeAll(async () => {
  ({ db, close } = await testDatabase());
  const secret = randomBytes(32).toString('base64');
  context = {
    auth: createAuth({ db, baseUrl: 'https://householdr.example.org', secret }),
    db,
    clock: settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z')),
    counterKey: counterKeys(secret),
  };
});
afterAll(() => close());
// Every test starts with no counts.
beforeEach(async () => {
  await db.delete(rateLimits);
});

/** A new account with `password`, its address confirmed unless said otherwise. */
const newAccount = async (emailVerified = true) => {
  const email = `person-${String(++next)}@example.org`;
  return { id: await createTestAccount(context.auth, { email, password }, emailVerified), email };
};
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const signIn = (email: string, typed: string, address = '192.0.2.1') =>
  signInWithPassword(context, { email, password: typed }, { address, userAgent: firefox });
const later = (seconds: number) => context.clock.now().add({ seconds });

describe('signing in with a password (ADR-0010 §2)', () => {
  it('starts a session in a __Host- cookie (ADR-0017 §4)', async () => {
    const account = await newAccount();
    const result = await signIn(account.email, password);
    if (!result.ok) throw new Error(`Not signed in: ${result.error}`);
    expect(result.cookies).toEqual([
      {
        name: '__Host-householdr.session_token',
        value: expect.stringMatching(/^[\w-]+\.[\w+/=-]+$/) as string,
        options: {
          path: '/',
          maxAge: 2_592_000,
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        },
      },
    ]);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, account.id));
    expect(rows).toHaveLength(1);
  });

  it('keeps the names of the browser and system, and nothing else of the client (ADR-0012 §2)', async () => {
    const account = await newAccount();
    await signIn(account.email, password);
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, account.id));
    expect(row).toMatchObject({
      browser: 'Firefox',
      system: 'Linux',
      userAgent: null,
      ipAddress: null,
    });
  });

  it('takes the e-mail address however it is typed', async () => {
    const account = await newAccount();
    expect(await signIn(`  ${account.email.toUpperCase()} `, password)).toMatchObject({ ok: true });
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const account = await newAccount();
    expect(await signIn(account.email, 'not the password')).toEqual({
      ok: false,
      error: 'incorrect',
    });
    expect(await signIn('nobody@example.org', password)).toEqual({
      ok: false,
      error: 'incorrect',
    });
  });

  it('turns away what isn’t an e-mail address and a password, without counting it', async () => {
    expect(
      await signInWithPassword(
        context,
        { email: 'robin' },
        { address: '192.0.2.1', userAgent: null },
      ),
    ).toEqual({
      ok: false,
      error: 'incorrect',
    });
    expect(await db.select().from(rateLimits)).toEqual([]);
  });

  it('won’t sign in to an account whose address isn’t confirmed, without counting a failure', async () => {
    const account = await newAccount(false);
    expect(await signIn(account.email, password)).toEqual({ ok: false, error: 'unverified' });
    for (const row of await db.select().from(rateLimits)) expect(row.count).toBe(0);
  });
});

describe('the waits after failures (ADR-0010 §2, clarification)', () => {
  it('start after 5 failures for an e-mail address, and turn attempts away unchecked', async () => {
    const account = await newAccount();
    for (let i = 0; i < 6; i++) {
      expect(await signIn(account.email, 'wrong')).toMatchObject({ error: 'incorrect' });
    }
    // Even the right password is turned away during the wait.
    expect(await signIn(account.email, password)).toEqual({
      ok: false,
      error: 'wait',
      until: later(1),
    });
    context.clock.advance({ seconds: 1 });
    expect(await signIn(account.email, password)).toMatchObject({ ok: true });
  });

  it('start again from nothing for the e-mail address once it signs in', async () => {
    const account = await newAccount();
    for (let i = 0; i < 5; i++) await signIn(account.email, 'wrong');
    await signIn(account.email, password);
    for (let i = 0; i < 6; i++) {
      expect(await signIn(account.email, 'wrong')).toMatchObject({ error: 'incorrect' });
    }
  });

  it('start after 20 failures from an IP address, across e-mail addresses', async () => {
    for (let i = 0; i < 21; i++) {
      expect(await signIn(`guess-${String(i)}@example.org`, 'wrong')).toMatchObject({
        error: 'incorrect',
      });
    }
    expect(await signIn('another@example.org', 'wrong')).toEqual({
      ok: false,
      error: 'wait',
      until: later(1),
    });
    // Another address isn't slowed down.
    expect(await signIn('another@example.org', 'wrong', '198.51.100.7')).toMatchObject({
      error: 'incorrect',
    });
  });

  it('count an IPv6 network’s addresses together', async () => {
    for (let i = 0; i < 21; i++) {
      await signIn(`guess-${String(i)}@example.org`, 'wrong', `2001:db8:0:12::${String(i + 1)}`);
    }
    expect(await signIn('another@example.org', 'wrong', '2001:db8:0:12:ffff::1')).toMatchObject({
      error: 'wait',
    });
  });

  it('keep an IP address’s failures when someone there signs in, without adding a wait', async () => {
    const account = await newAccount();
    for (let i = 0; i < 21; i++) await signIn(`guess-${String(i)}@example.org`, 'wrong');
    context.clock.advance({ seconds: 1 });
    expect(await signIn(account.email, password)).toMatchObject({ ok: true });
    // The success didn't move the wait on: the network's next failure is the 22nd.
    expect(await signIn('another@example.org', 'wrong')).toMatchObject({ error: 'incorrect' });
    expect(await signIn('another@example.org', 'wrong')).toEqual({
      ok: false,
      error: 'wait',
      until: later(2),
    });
  });

  it('let no burst of attempts past the count', async () => {
    const account = await newAccount();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => signIn(account.email, 'wrong')),
    );
    // 5 free failures and the one that starts the wait; the rest are turned away unchecked.
    expect(results.filter((result) => !result.ok && result.error === 'incorrect')).toHaveLength(6);
    expect(results.filter((result) => !result.ok && result.error === 'wait')).toHaveLength(6);
  });
});
