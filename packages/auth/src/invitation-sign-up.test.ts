import {
  addAdult,
  createHousehold,
  invite,
  membership,
  revokeInvitation,
} from '@householdr/application';
import { accounts, inHousehold, members, passkeys, sessions } from '@householdr/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cookie } from './cookies';
import {
  invitationPasskeyOptions,
  joinWithPasskey,
  type InvitationSignUpContext,
} from './invitation-sign-up';
import { currentSession, sessionCookie } from './sessions';
import { signUpLinkAddress } from './sign-up';
import {
  createTestAccount,
  signUpLinkTo,
  testAuthenticator,
  testSignInContext,
  type TestAuthenticator,
} from './testing';

// Joining a household through an invitation with a new account and its passkey (ADR-0010 §1, §5,
// clarifications), on a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let context: InvitationSignUpContext;
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
const newAddress = () => `sam-${String(++next)}@example.org`;
const fields = { name: 'Sam', language: 'en', terms: true };

/** Request headers carrying `cookies`, as Firefox on Linux sends them back. */
const headersWith = (...cookies: Cookie[]) =>
  new Headers({
    cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
    'user-agent': firefoxOnLinux,
  });

/** Ash Lane, with Kim's profile, and the head's context to manage it. */
const household = async () => {
  const head = await createTestAccount(test.context.auth, {
    email: newAddress(),
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
    {
      db: test.context.db,
      actor: { account: head, twoFactor: true },
      account: { id: head, managed: false, guardians: [] },
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
  const member = await membership(test.context, head, created.householdId);
  if (!member) throw new Error('Not a member');
  const heads = {
    ...test.context,
    householdId: created.householdId,
    member: { ...member, twoFactor: true },
  };
  const kim = await addAdult(heads, { name: 'Kim' });
  if (!kim.ok) throw new Error('No profile');
  const link = await invite(heads, { member: kim.memberId });
  if (!link.ok) throw new Error('No link');
  return { heads, kim: kim.memberId, invitation: link.token };
};

type CreationOptions = Parameters<TestAuthenticator['register']>[0];

/** The two calls the invitation page makes, with `input`. */
const join = async (
  signUpToken: string | undefined,
  invitationToken: string | undefined,
  input: Record<string, unknown> = fields,
  between?: () => Promise<unknown>,
) => {
  const started = await invitationPasskeyOptions(context, signUpToken, invitationToken, input);
  if (!started.ok) return started;
  const response = testAuthenticator().register(started.options as CreationOptions, site);
  await between?.();
  return joinWithPasskey(
    context,
    signUpToken,
    invitationToken,
    headersWith(...started.cookies),
    { ...input, response },
    client,
  );
};

const accountAt = async (email: string) => {
  const [account] = await test.context.db.select().from(accounts).where(eq(accounts.email, email));
  return account ?? null;
};

describe('joining with a new account (ADR-0010 §1, §5)', () => {
  it('creates the account, its passkey and session, and links it to the profile, together', async () => {
    const { heads, kim, invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const joined = await join(token, invitation);
    if (!joined.ok) throw new Error(`Not joined: ${joined.error}`);
    expect(joined.householdId).toBe(heads.householdId);

    const account = await accountAt(email);
    expect(account).toMatchObject({
      name: 'Sam',
      emailVerified: true,
      // Their language and the household's country (ADR-0016 §2).
      culture: 'en-BE',
      // The terms they accepted, and when, as the founding head's account keeps them (ADR-0010
      // §1, clarification of 2026-10-09).
      termsVersion: '2026-10-01',
      termsAcceptedAt: new Date('2026-10-08T08:00:00Z'),
    });
    if (!account) throw new Error('No account');
    const [profile] = await inHousehold(test.context.db, heads.householdId, (tx) =>
      tx.select().from(members).where(eq(members.id, kim)),
    );
    // The profile keeps its name (ADR-0010 §1, clarification).
    expect(profile).toMatchObject({ name: 'Kim', role: 'adult', accountId: account.id });
    expect(
      await test.context.db.select().from(passkeys).where(eq(passkeys.userId, account.id)),
    ).toEqual([expect.objectContaining({ browser: 'Firefox', system: 'Linux' })]);

    const cookie = joined.cookies.find(({ name }) => name === sessionCookie);
    if (!cookie) throw new Error('No session cookie');
    const { session } = await currentSession(
      test.context.auth,
      new Headers({ cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` }),
    );
    expect(session).toMatchObject({ accountId: account.id });
    // Both links are used up.
    expect(await signUpLinkAddress(context, token)).toBeNull();
    expect(await join(await signUpLinkTo(context, newAddress()), invitation)).toEqual({
      ok: false,
      error: 'invitation',
    });
  });

  it('says what isn’t valid before a passkey is made', async () => {
    const { invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    expect(await join(token, invitation, { name: ' ', language: 'xx', terms: false })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'language', 'terms'],
    });
    expect(await accountAt(email)).toBeNull();
  });

  it('creates nothing unless the terms are accepted, where the instance has them (ADR-0010 §1, clarification)', async () => {
    const { invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const refused = { ok: false, error: 'invalid', fields: ['terms'] };
    for (const terms of [undefined, false, 'yes']) {
      const input = { name: 'Sam', language: 'en', terms };
      // At both steps: the second checks again, since a client can skip the first.
      expect(await invitationPasskeyOptions(context, token, invitation, input)).toEqual(refused);
      expect(
        await joinWithPasskey(context, token, invitation, headersWith(), input, client),
      ).toEqual(refused);
    }
    expect(await accountAt(email)).toBeNull();
    // Both links still work, for an attempt that accepts them.
    expect(await signUpLinkAddress(context, token)).toBe(email);
    expect(await join(token, invitation)).toMatchObject({ ok: true });
    expect(await accountAt(email)).toMatchObject({ termsVersion: '2026-10-01' });
  });

  it('asks nothing about terms on an instance without them (ADR-0010 §1, ADR-0021 §5, clarifications)', async () => {
    const { invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const withoutTerms = { ...context, terms: null };
    const input = { name: 'Sam', language: 'en' };
    const started = await invitationPasskeyOptions(withoutTerms, token, invitation, input);
    if (!started.ok) throw new Error(`No options: ${started.error}`);
    const response = testAuthenticator().register(started.options as CreationOptions, site);
    const joined = await joinWithPasskey(
      withoutTerms,
      token,
      invitation,
      headersWith(...started.cookies),
      { ...input, response },
      client,
    );
    expect(joined).toMatchObject({ ok: true });
    expect(await accountAt(email)).toMatchObject({ termsVersion: null, termsAcceptedAt: null });
  });

  it('turns away a sign-up link that no longer works, or an invitation that doesn’t', async () => {
    const { invitation } = await household();
    expect(await join('not-a-link', invitation)).toEqual({ ok: false, error: 'expired' });
    const token = await signUpLinkTo(context, newAddress());
    expect(await join(token, 'x'.repeat(43))).toEqual({ ok: false, error: 'invitation' });
  });

  it('creates nothing when the invitation stops working meanwhile, and keeps the sign-up link', async () => {
    const { heads, kim, invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const revoked = await join(token, invitation, fields, () =>
      revokeInvitation(heads, { member: kim }),
    );
    expect(revoked).toEqual({ ok: false, error: 'invitation' });
    expect(await accountAt(email)).toBeNull();
    expect(await signUpLinkAddress(context, token)).toBe(email);
  });

  it('creates nothing when the invitation is used up inside the transaction', async () => {
    const { invitation } = await household();
    const first = newAddress();
    const second = newAddress();
    const [one, two] = [await signUpLinkTo(context, first), await signUpLinkTo(context, second)];
    const results = await Promise.all([join(one, invitation), join(two, invitation)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'invitation' }]);
    const created = [await accountAt(first), await accountAt(second)].filter(Boolean);
    expect(created).toHaveLength(1);
    const ids = created.map((account) => account?.id ?? '');
    expect(
      (await test.context.db.select().from(sessions)).filter((row) => ids.includes(row.userId)),
    ).toHaveLength(1);
  });

  it('refuses a passkey made for another challenge', async () => {
    const { invitation } = await household();
    const email = newAddress();
    const token = await signUpLinkTo(context, email);
    const started = await invitationPasskeyOptions(context, token, invitation, fields);
    if (!started.ok) throw new Error('No options');
    const other = await invitationPasskeyOptions(context, token, invitation, fields);
    if (!other.ok) throw new Error('No options');
    const response = testAuthenticator().register(other.options as CreationOptions, site);
    expect(
      await joinWithPasskey(
        context,
        token,
        invitation,
        headersWith(...started.cookies),
        { ...fields, response },
        client,
      ),
    ).toEqual({ ok: false, error: 'failed' });
    expect(await accountAt(email)).toBeNull();
  });
});
