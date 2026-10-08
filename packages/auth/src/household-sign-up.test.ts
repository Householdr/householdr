import { createHousehold } from '@householdr/application';
import {
  accountEmails,
  accounts,
  households,
  inHousehold,
  members,
  passkeys,
  sessions,
  verifications,
} from '@householdr/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Cookie } from './cookies';
import {
  createHouseholdWithPasskey,
  householdPasskeyOptions,
  type HouseholdSignUpContext,
} from './household-sign-up';
import { passkeyChallenge, signInWithPasskey } from './passkey-sign-in';
import { signedInRecently } from './passkeys';
import { currentSession, sessionCookie } from './sessions';
import { signInWithPassword } from './sign-in';
import { signUpLinkAddress } from './sign-up';
import {
  createTestAccount,
  signUpLinkTo,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from './testing';

// Creating a household with its head's account and passkey, from the first step of onboarding
// (ADR-0007 §2; ADR-0010 §1, §3, clarifications), on a real database (TEST-11).

// The real use case, which a test can make fail.
vi.mock('@householdr/application', async (original) => {
  const actual = await original<typeof import('@householdr/application')>();
  return { ...actual, createHousehold: vi.fn(actual.createHousehold) };
});

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: HouseholdSignUpContext;
const terms = { url: 'https://householdr.example.org/terms', version: '2026-10-01' };

beforeAll(async () => {
  test = await testSignInContext();
  context = { ...test.context, terms };
});
afterAll(() => test.close());

const site = 'https://householdr.example.org';
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const client = { userAgent: firefoxOnLinux };
let next = 0;
const newAddress = () => `person-${String(++next)}@example.org`;

/** What the first step's form sends, filled in as the head would, on an instance with terms. */
const household = {
  name: 'Ash Lane',
  headName: 'Robin',
  country: 'BE',
  timeZone: 'Europe/Brussels',
  language: 'en',
  headLanguage: 'en',
  weekStartDay: 1,
  adult: true,
};
const fields = { ...household, terms: true };

/** Request headers carrying `cookies`, as Firefox on Linux sends them back. */
const headersWith = (...cookies: Cookie[]) =>
  new Headers({
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    'user-agent': firefoxOnLinux,
  });

type CreationOptions = Parameters<TestAuthenticator['register']>[0];

/** The first step's two calls, as its page makes them, with `input` and from `origin`. */
const signUp = async (
  token: string | undefined,
  input: Record<string, unknown> = fields,
  { authenticator = testAuthenticator(), origin = site, signedIn = [] as Cookie[] } = {},
) => {
  const started = await householdPasskeyOptions(context, token, input);
  if (!started.ok) return started;
  const response = authenticator.register(started.options as CreationOptions, origin);
  const headers = headersWith(...signedIn, ...started.cookies);
  return createHouseholdWithPasskey(context, token, headers, { ...input, response }, client);
};

/** What is stored for `email`: its account, and that account's passkeys, sessions and e-mails. */
const storedFor = async (email: string) => {
  const { db } = test.context;
  const [account] = await db.select().from(accounts).where(eq(accounts.email, email));
  if (!account) return null;
  return {
    account,
    passkeys: await db.select().from(passkeys).where(eq(passkeys.userId, account.id)),
    sessions: await db.select().from(sessions).where(eq(sessions.userId, account.id)),
    emails: await db
      .select({ kind: accountEmails.kind })
      .from(accountEmails)
      .where(eq(accountEmails.accountId, account.id)),
  };
};

/** The household the last call of the use case created, as a transaction set to it sees it. */
const lastHousehold = async () => {
  const last = vi.mocked(createHousehold).mock.results.at(-1);
  const result = (await last?.value) as Awaited<ReturnType<typeof createHousehold>> | undefined;
  if (!result?.ok) throw new Error('No household was created.');
  return inHousehold(test.context.db, result.householdId, async (tx) => ({
    households: await tx.select().from(households),
    members: await tx.select().from(members),
  }));
};

/** Makes the sign-up link to `email` expire, by the library's clock and the context's. */
const expire = async (email: string) => {
  const real = Temporal.Now.instant();
  const clock = context.clock.now();
  const earlier = Temporal.Instant.compare(real, clock) < 0 ? real : clock;
  await test.context.db
    .update(verifications)
    .set({ expiresAt: new Date(earlier.subtract({ minutes: 1 }).epochMilliseconds) })
    .where(and(eq(verifications.purpose, 'sign-up'), eq(verifications.value, email)));
};

describe('creating a household with a passkey (ADR-0007 §2)', () => {
  it('creates the account, its passkey, its session, the household and its head together', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const authenticator = testAuthenticator();
    const started = await householdPasskeyOptions(context, token, fields);
    if (!started.ok) throw new Error(`No options: ${started.error}`);
    // The passkey is shown under the address in a password manager.
    expect(started.options).toMatchObject({
      rp: { id: 'householdr.example.org', name: 'Householdr' },
      user: { name: email, displayName: email },
    });
    const response = authenticator.register(started.options as CreationOptions, site);
    const result = await createHouseholdWithPasskey(
      context,
      token,
      headersWith(...started.cookies),
      { ...fields, response },
      client,
    );
    if (!result.ok) throw new Error(`Not created: ${result.error}`);

    const stored = await storedFor(email);
    expect(stored?.account).toMatchObject({
      name: 'Robin',
      emailVerified: true,
      culture: 'en-BE',
      termsVersion: '2026-10-01',
      termsAcceptedAt: new Date('2026-10-08T08:00:00Z'),
    });
    // Named after its device, like any passkey; the first is part of creating the account, so no
    // e-mail says it was added (ADR-0010 §2).
    expect(stored?.passkeys).toMatchObject([{ name: null, browser: 'Firefox', system: 'Linux' }]);
    expect(stored?.sessions).toMatchObject([{ browser: 'Firefox', system: 'Linux' }]);
    expect(stored?.emails).toEqual([]);
    const accountId = stored?.account.id;
    expect(await lastHousehold()).toMatchObject({
      households: [
        {
          name: 'Ash Lane',
          country: 'BE',
          timeZone: 'Europe/Brussels',
          language: 'en',
          weekStartDay: 1,
        },
      ],
      members: [{ name: 'Robin', role: 'head', birthDate: null, accountId }],
    });

    // Signed in, recently enough to change how (ADR-0010 §6).
    const cookie = result.cookies.find(({ name }) => name === sessionCookie);
    if (!cookie) throw new Error('No session cookie');
    const { session } = await currentSession(context.auth, headersWith(cookie));
    expect(session?.accountId).toBe(accountId);
    if (session) expect(await signedInRecently(context, session)).toBe(true);
    // And the passkey signs in again later.
    const challenge = await passkeyChallenge(context, new Headers());
    const signed = authenticator.authenticate(challenge.options as never, site);
    expect(
      await signInWithPasskey(context, headersWith(...challenge.cookies), { response: signed }),
    ).toMatchObject({ ok: true });
  });

  it('makes the head’s culture from their language and the household’s country (ADR-0008 §6)', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const result = await signUp(token, {
      ...fields,
      country: 'ES',
      timeZone: 'Atlantic/Canary',
      weekStartDay: 7,
    });
    expect(result).toMatchObject({ ok: true });
    expect((await storedFor(email))?.account.culture).toBe('en-ES');
    expect((await lastHousehold()).households).toMatchObject([
      { country: 'ES', timeZone: 'Atlantic/Canary', weekStartDay: 7 },
    ]);
  });

  it('says which fields aren’t valid before a passkey is made, and keeps the link', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const invalid = { ...fields, name: ' ', adult: false, headLanguage: 'de', terms: false };
    const said = {
      ok: false,
      error: 'invalid',
      fields: ['name', 'adult', 'headLanguage', 'terms'],
    };
    expect(await householdPasskeyOptions(context, token, invalid)).toEqual(said);
    expect(
      await householdPasskeyOptions(context, token, { ...fields, timeZone: 'Europe/Paris' }),
    ).toEqual({ ok: false, error: 'invalid', fields: ['timeZone'] });
    expect(await householdPasskeyOptions(context, token, null)).toEqual({
      ok: false,
      error: 'invalid',
      fields: [],
    });
    // The second step checks them again.
    const started = await householdPasskeyOptions(context, token, fields);
    if (!started.ok) throw new Error('No options');
    const response = testAuthenticator().register(started.options as CreationOptions, site);
    const headers = headersWith(...started.cookies);
    expect(
      await createHouseholdWithPasskey(context, token, headers, { ...invalid, response }, client),
    ).toEqual(said);
    expect(await storedFor(email)).toBeNull();
    expect(await signUpLinkAddress(context, token)).toBe(email);
  });

  it('uses the link up, so it creates one household', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const first = await householdPasskeyOptions(context, token, fields);
    const second = await householdPasskeyOptions(context, token, fields);
    if (!first.ok || !second.ok) throw new Error('No options');
    const create = (started: typeof first) =>
      createHouseholdWithPasskey(
        context,
        token,
        headersWith(...started.cookies),
        {
          ...fields,
          response: testAuthenticator().register(started.options as CreationOptions, site),
        },
        client,
      );
    expect(await create(first)).toMatchObject({ ok: true });
    expect(await create(second)).toEqual({ ok: false, error: 'expired' });
    expect(await signUpLinkAddress(context, token)).toBeNull();
    expect(await householdPasskeyOptions(context, token, fields)).toEqual({
      ok: false,
      error: 'expired',
    });
    expect((await storedFor(email))?.passkeys).toHaveLength(1);
  });

  it('creates one account when the link is used twice at the same time', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const results = await Promise.all([signUp(token), signUp(token)]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(results).toContainEqual({ ok: false, error: 'expired' });
    expect((await storedFor(email))?.passkeys).toHaveLength(1);
  });

  it('says when there is no link, or one that has expired', async () => {
    for (const token of [undefined, '', 'made-up', 'x'.repeat(257)]) {
      expect(await signUp(token)).toEqual({ ok: false, error: 'expired' });
    }
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    // Expired between the two steps.
    const started = await householdPasskeyOptions(context, token, fields);
    if (!started.ok) throw new Error('No options');
    await expire(email);
    const response = testAuthenticator().register(started.options as CreationOptions, site);
    expect(
      await createHouseholdWithPasskey(
        context,
        token,
        headersWith(...started.cookies),
        { ...fields, response },
        client,
      ),
    ).toEqual({ ok: false, error: 'expired' });
    expect(await signUp(token)).toEqual({ ok: false, error: 'expired' });
    expect(await storedFor(email)).toBeNull();
  });

  it('refuses a passkey made for another site or another challenge, and keeps nothing', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    expect(await signUp(token, fields, { origin: 'https://elsewhere.example.org' })).toEqual({
      ok: false,
      error: 'failed',
    });
    const started = await householdPasskeyOptions(context, token, fields);
    if (!started.ok) throw new Error('No options');
    const forged = testAuthenticator().register(
      { challenge: 'not-the-challenge', rp: { id: 'householdr.example.org' } },
      site,
    );
    const made = testAuthenticator().register(started.options as CreationOptions, site);
    const attempts = [
      { headers: headersWith(...started.cookies), response: forged },
      // Without the cookie that keeps the challenge.
      { headers: headersWith(), response: made },
      { headers: headersWith(...started.cookies), response: 'not a passkey' },
    ];
    for (const { headers, response } of attempts) {
      expect(
        await createHouseholdWithPasskey(context, token, headers, { ...fields, response }, client),
      ).toEqual({ ok: false, error: 'failed' });
    }
    expect(await storedFor(email)).toBeNull();
    expect(await signUpLinkAddress(context, token)).toBe(email);
  });

  it('keeps nothing when creating the household fails', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const actual =
      await vi.importActual<typeof import('@householdr/application')>('@householdr/application');
    let householdId = '';
    vi.mocked(createHousehold).mockImplementationOnce(async (...args) => {
      const result = await actual.createHousehold(...args);
      if (result.ok) householdId = result.householdId;
      throw new Error('Creating the household failed.');
    });
    await expect(signUp(token)).rejects.toThrow('Creating the household failed.');
    vi.mocked(createHousehold).mockResolvedValueOnce({ ok: false, error: 'not-allowed' });
    await expect(signUp(token)).rejects.toThrow('No household was created: not-allowed.');
    // Without an account there can't be a passkey or a session either: they refer to it.
    expect(await storedFor(email)).toBeNull();
    expect(
      await inHousehold(test.context.db, householdId, (tx) => tx.select().from(households)),
    ).toEqual([]);
    expect(await signUpLinkAddress(context, token)).toBe(email);
  });

  it('treats an address that got an account in the meantime as a link that no longer works', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const started = await householdPasskeyOptions(context, token, fields);
    if (!started.ok) throw new Error('No options');
    await createTestAccount(context.auth, { email, password: 'correct horse battery staple' });
    const response = testAuthenticator().register(started.options as CreationOptions, site);
    expect(
      await createHouseholdWithPasskey(
        context,
        token,
        headersWith(...started.cookies),
        { ...fields, response },
        client,
      ),
    ).toEqual({ ok: false, error: 'expired' });
    const stored = await storedFor(email);
    expect(stored?.account.name).toBe('Robin');
    expect(stored?.passkeys).toEqual([]);
    expect(stored?.sessions).toEqual([]);
  });

  it('asks nothing about terms on an instance without them (ADR-0007 §2, clarification)', async () => {
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const withoutTerms = { ...context, terms: null };
    const started = await householdPasskeyOptions(withoutTerms, token, household);
    if (!started.ok) throw new Error(`No options: ${started.error}`);
    const response = testAuthenticator().register(started.options as CreationOptions, site);
    const headers = headersWith(...started.cookies);
    const input = { ...household, response };
    expect(
      await createHouseholdWithPasskey(withoutTerms, token, headers, input, client),
    ).toMatchObject({ ok: true });
    expect((await storedFor(email))?.account).toMatchObject({
      termsVersion: null,
      termsAcceptedAt: null,
    });
  });

  it('leaves out whoever is signed in on the device', async () => {
    const other = newAddress();
    const password = 'correct horse battery staple';
    await createTestAccount(context.auth, { email: other, password });
    const signedIn = await signInWithPassword(
      test.context,
      { email: other, password },
      { address: '192.0.2.1', ...client },
    );
    if (!signedIn.ok) throw new Error('Not signed in');
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    expect(await signUp(token, fields, { signedIn: signedIn.cookies })).toMatchObject({ ok: true });
    expect((await storedFor(email))?.passkeys).toHaveLength(1);
    expect((await storedFor(other))?.passkeys).toEqual([]);
  });
});
