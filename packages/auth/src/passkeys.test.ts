import { recordingLogger } from '@householdr/application/testing';
import { accountEmails, jobQueue, passkeys, sessions, type JobQueue } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cookie } from './cookies';
import {
  accountPasskeys,
  addPasskey,
  confirmWithPassword,
  passkeyOptions,
  removePasskey,
  signedInRecently,
  type PasskeysContext,
} from './passkeys';
import { currentSession, type Session } from './sessions';
import { signInWithPassword } from './sign-in';
import { householdPasskeyOptions } from './household-sign-up';
import {
  addTestPasskey,
  createTestAccount,
  signUpLinkTo,
  testAuthenticator,
  testSignInContext,
} from './testing';

// Adding and removing passkeys on the security page (ADR-0010 §2, §6), on a real database
// (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: PasskeysContext;

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = { ...test.context, queue, logger: recordingLogger() };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});

const origin = 'https://householdr.example.org';
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

/** A new account, signed in: its session, and the cookie that carries it. */
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

/** Adds a passkey made by a test authenticator, as the security page's endpoints would. */
const added = ({ session, cookie }: { session: Session; cookie: Cookie }) =>
  addTestPasskey(context, session, cookie, client);

/** Makes the session's sign-in 11 minutes old, by the library's clock and the context's. */
const signedInLongAgo = async (sessionId: string) => {
  const real = Temporal.Now.instant();
  const clock = context.clock.now();
  const earlier = Temporal.Instant.compare(real, clock) < 0 ? real : clock;
  const at = new Date(earlier.subtract({ minutes: 11 }).epochMilliseconds);
  await test.context.db.update(sessions).set({ createdAt: at }).where(eq(sessions.id, sessionId));
};

/** The kinds of the account e-mails waiting for `accountId`. */
const waiting = async (accountId: string) =>
  (
    await test.context.db
      .select({ kind: accountEmails.kind })
      .from(accountEmails)
      .where(eq(accountEmails.accountId, accountId))
  ).map((row) => row.kind);

describe('adding a passkey (ADR-0010 §2)', () => {
  it('names it after its device, and e-mails the member', async () => {
    const person = await signedIn();
    expect(await added(person)).toEqual({ ok: true });
    expect(await accountPasskeys(context, person.session)).toEqual([
      {
        id: expect.any(String) as string,
        browser: 'Firefox',
        system: 'Linux',
        addedAt: expect.any(Temporal.Instant) as Temporal.Instant,
      },
    ]);
    expect(await waiting(person.session.accountId)).toEqual(['passkey-added']);
  });

  it('shows the passkey under the account’s e-mail address in a password manager', async () => {
    const person = await signedIn();
    const options = await passkeyOptions(context, person.session, headersWith(person.cookie));
    expect(options.ok && options.options).toMatchObject({
      rp: { id: 'householdr.example.org', name: 'Householdr' },
      user: { name: person.email },
    });
  });

  it('refuses a passkey made for another challenge, or without one', async () => {
    const person = await signedIn();
    const options = await passkeyOptions(context, person.session, headersWith(person.cookie));
    if (!options.ok) throw new Error('No options');
    const forged = testAuthenticator().register(
      { challenge: 'not-the-challenge', rp: { id: 'householdr.example.org' } },
      origin,
    );
    expect(
      await addPasskey(
        context,
        person.session,
        headersWith(person.cookie, ...options.cookies),
        { response: forged },
        client,
      ),
    ).toEqual({ ok: false, error: 'failed' });
    // Without the cookie that keeps the challenge.
    const made = testAuthenticator().register(
      options.options as Parameters<ReturnType<typeof testAuthenticator>['register']>[0],
      origin,
    );
    expect(
      await addPasskey(
        context,
        person.session,
        headersWith(person.cookie),
        { response: made },
        client,
      ),
    ).toEqual({ ok: false, error: 'failed' });
    expect(
      await addPasskey(context, person.session, headersWith(person.cookie), {}, client),
    ).toEqual({ ok: false, error: 'failed' });
    expect(await accountPasskeys(context, person.session)).toEqual([]);
    expect(await waiting(person.session.accountId)).toEqual([]);
  });

  it('checks it against the site’s own address, not the one the request names', async () => {
    const person = await signedIn();
    const options = await passkeyOptions(context, person.session, headersWith(person.cookie));
    if (!options.ok) throw new Error('No options');
    const fromElsewhere = 'https://elsewhere.example.org';
    const response = testAuthenticator().register(
      options.options as Parameters<ReturnType<typeof testAuthenticator>['register']>[0],
      fromElsewhere,
    );
    const headers = headersWith(person.cookie, ...options.cookies);
    headers.set('origin', fromElsewhere);
    expect(await addPasskey(context, person.session, headers, { response }, client)).toEqual({
      ok: false,
      error: 'failed',
    });
  });

  it('asks to confirm it is you when the sign-in is over 10 minutes old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    expect(await signedInRecently(context, person.session)).toBe(true);
    await signedInLongAgo(person.session.id);
    expect(await signedInRecently(context, person.session)).toBe(false);
    expect(await passkeyOptions(context, person.session, headersWith(person.cookie))).toEqual({
      ok: false,
      error: 'confirm',
    });
  });

  it('asks again when the sign-in turned 10 minutes old after the challenge (ADR-0010 §6)', async () => {
    const person = await signedIn();
    const options = await passkeyOptions(context, person.session, headersWith(person.cookie));
    if (!options.ok) throw new Error('No options');
    await signedInLongAgo(person.session.id);
    const response = testAuthenticator().register(
      options.options as Parameters<ReturnType<typeof testAuthenticator>['register']>[0],
      origin,
    );
    const headers = headersWith(person.cookie, ...options.cookies);
    expect(await addPasskey(context, person.session, headers, { response }, client)).toEqual({
      ok: false,
      error: 'confirm',
    });
    expect(await accountPasskeys(context, person.session)).toEqual([]);
  });

  it('is only for the account signed in, outside signing up (ADR-0010 §1, §2)', async () => {
    // Without a session, the library makes no challenge.
    await expect(
      context.auth.api.generatePasskeyRegistrationOptions({ headers: new Headers() }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    // A challenge made for signing up adds nothing outside it: not without a session...
    const token = await signUpLinkTo(test.context, `person-${String(++next)}@example.org`);
    const fields = {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      headLanguage: 'en',
      weekStartDay: 1,
      adult: true,
    };
    const forSignUp = await householdPasskeyOptions({ ...context, terms: null }, token, fields);
    if (!forSignUp.ok) throw new Error('No options');
    const options = forSignUp.options as Parameters<
      ReturnType<typeof testAuthenticator>['register']
    >[0];
    const before = await test.context.db.select({ id: passkeys.id }).from(passkeys);
    await expect(
      context.auth.api.verifyPasskeyRegistration({
        headers: headersWith(...forSignUp.cookies),
        body: { response: testAuthenticator().register(options, origin) },
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    // ...nor to the account signed in.
    const person = await signedIn();
    const headers = headersWith(person.cookie, ...forSignUp.cookies);
    const response = testAuthenticator().register(options, origin);
    expect(await addPasskey(context, person.session, headers, { response }, client)).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(await test.context.db.select({ id: passkeys.id }).from(passkeys)).toEqual(before);
  });
});

describe('removing a passkey (ADR-0010 §2)', () => {
  it('removes it, and e-mails the member in the same change', async () => {
    const person = await signedIn();
    await added(person);
    const [passkey] = await accountPasskeys(context, person.session);
    expect(await removePasskey(context, person.session, { passkey: passkey?.id })).toEqual({
      ok: true,
    });
    expect(await accountPasskeys(context, person.session)).toEqual([]);
    expect(await waiting(person.session.accountId)).toEqual(['passkey-added', 'passkey-removed']);
  });

  it('never removes another account’s passkey', async () => {
    const owner = await signedIn();
    await added(owner);
    const [passkey] = await accountPasskeys(context, owner.session);
    const other = await signedIn();
    expect(await removePasskey(context, other.session, { passkey: passkey?.id })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await removePasskey(context, other.session, { passkey: 'not-a-passkey' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await accountPasskeys(context, owner.session)).toHaveLength(1);
    expect(await waiting(other.session.accountId)).toEqual([]);
  });

  it('asks to confirm it is you when the sign-in is over 10 minutes old (ADR-0010 §6)', async () => {
    const person = await signedIn();
    await added(person);
    const [passkey] = await accountPasskeys(context, person.session);
    await signedInLongAgo(person.session.id);
    expect(await removePasskey(context, person.session, { passkey: passkey?.id })).toEqual({
      ok: false,
      error: 'confirm',
    });
    expect(await accountPasskeys(context, person.session)).toHaveLength(1);
  });
});

describe('confirming it is you (ADR-0010 §6)', () => {
  it('signs in again with the password, in place of the old session', async () => {
    const person = await signedIn();
    await signedInLongAgo(person.session.id);
    expect(
      await confirmWithPassword(context, person.session, { password: 'not the password' }, client),
    ).toEqual({ ok: false, error: 'incorrect' });
    const confirmed = await confirmWithPassword(context, person.session, { password }, client);
    if (!confirmed.ok) throw new Error(`Not confirmed: ${confirmed.error}`);
    const [cookie] = confirmed.cookies;
    if (!cookie) throw new Error('No cookie');
    const { session } = await currentSession(test.context.auth, headersWith(cookie));
    if (!session) throw new Error('No session');
    expect(session.id).not.toBe(person.session.id);
    expect(session.accountId).toBe(person.session.accountId);
    expect(await signedInRecently(context, session)).toBe(true);
    expect(
      await test.context.db.select().from(sessions).where(eq(sessions.id, person.session.id)),
    ).toEqual([]);
    expect(await added({ session, cookie })).toEqual({ ok: true });
  });
});

describe('the passkeys table', () => {
  it('never keeps the library’s own name for a passkey', async () => {
    const person = await signedIn();
    await added(person);
    await expect(
      test.context.db
        .update(passkeys)
        .set({ name: 'Robin’s phone' })
        .where(eq(passkeys.userId, person.session.accountId)),
    ).rejects.toThrow();
  });
});
