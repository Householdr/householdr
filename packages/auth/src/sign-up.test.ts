import { accountEmails, jobQueue, rateLimits, verifications, type JobQueue } from '@householdr/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareAccountEmail } from './account-emails';
import {
  deleteExpiredSignUpLinks,
  requestSignUp,
  signUpLinkAddress,
  type SignUpContext,
} from './sign-up';
import { createTestAccount, testSignInContext } from './testing';

// Asking for a link to sign up, and the link it sends (ADR-0010 §1, clarifications), on a real
// database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let queue: JobQueue;
let context: SignUpContext & typeof test.context;

beforeAll(async () => {
  test = await testSignInContext();
  queue = await jobQueue(test.context.db).start();
  context = { ...test.context, queue };
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await test.close();
});
beforeEach(async () => {
  await test.context.db.delete(rateLimits);
});

const client = { address: '192.0.2.1' };
let next = 0;
const newAddress = () => `person-${String(++next)}@example.org`;

/** The rows of the sign-up e-mails waiting for `email`. */
const waiting = (email: string) =>
  test.context.db
    .select({ id: accountEmails.id })
    .from(accountEmails)
    .where(and(eq(accountEmails.kind, 'sign-up'), eq(accountEmails.email, email)));

/** Asks for a link for `email` and returns its token, as the worker would send it. */
const signUpLink = async (email: string) => {
  await requestSignUp(context, { email }, client);
  const [row] = await waiting(email);
  const prepared = await prepareAccountEmail(test.context, row?.id ?? '');
  if (prepared?.kind !== 'sign-up') throw new Error('No link');
  await test.context.db.delete(accountEmails).where(eq(accountEmails.id, row?.id ?? ''));
  return { token: prepared.link.split('/').at(-1) ?? '', link: prepared.link };
};

/** When the link to `email` expires. */
const expiryOf = async (email: string) => {
  const [link] = await test.context.db
    .select({ expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(and(eq(verifications.purpose, 'sign-up'), eq(verifications.value, email)));
  if (!link) throw new Error('No link');
  return Temporal.Instant.fromEpochMilliseconds(link.expiresAt.getTime());
};

const at = (now: Temporal.Instant) => ({ ...context, clock: { now: () => now } });

describe('asking for a link to sign up (ADR-0010 §1)', () => {
  it('queues the e-mail for an address without an account', async () => {
    const email = newAddress();
    expect(await requestSignUp(context, { email: ` ${email.toUpperCase()}` }, client)).toEqual({
      ok: true,
    });
    expect(await waiting(email)).toHaveLength(1);
  });

  it('answers the same for an address with an account, and sends it nothing (clarification)', async () => {
    const email = newAddress();
    await createTestAccount(test.context.auth, { email, password: 'correct horse battery' });
    const before = await test.context.db.select().from(accountEmails);
    expect(await requestSignUp(context, { email }, client)).toEqual({ ok: true });
    expect(await test.context.db.select().from(accountEmails)).toEqual(before);
  });

  it('sends at most 3 an hour to one address, and still answers the same (ADR-0017 §5)', async () => {
    const email = newAddress();
    for (let i = 0; i < 5; i++) {
      expect(await requestSignUp(context, { email }, client)).toEqual({ ok: true });
    }
    expect(await waiting(email)).toHaveLength(3);
  });

  it('takes 10 sign-ups an hour from one network, whatever their addresses (ADR-0017 §5)', async () => {
    const network = { address: '2001:db8:1:2::1' };
    for (let i = 0; i < 10; i++) {
      expect(await requestSignUp(context, { email: newAddress() }, network)).toEqual({ ok: true });
    }
    const email = newAddress();
    const sameNetwork = { address: '2001:db8:1:2:ffff::9' };
    expect(await requestSignUp(context, { email }, sameNetwork)).toEqual({
      ok: false,
      error: 'wait',
    });
    expect(await waiting(email)).toEqual([]);
    expect(await requestSignUp(context, { email }, client)).toEqual({ ok: true });
    test.context.clock.advance({ hours: 1 });
    expect(await requestSignUp(context, { email: newAddress() }, network)).toEqual({ ok: true });
  });

  it('turns away what isn’t an e-mail address, without counting it', async () => {
    for (let i = 0; i < 11; i++) {
      expect(await requestSignUp(context, { email: 'robin' }, client)).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await requestSignUp(context, { email: newAddress() }, client)).toEqual({ ok: true });
  });
});

describe('the link to sign up (ADR-0010 §1, clarification)', () => {
  it('leads to this site, and knows the address it was sent to for 30 minutes', async () => {
    const email = newAddress();
    const { token, link } = await signUpLink(email);
    expect(link).toBe(`https://householdr.example.org/sign-up/${token}`);
    const expiry = await expiryOf(email);
    expect(await signUpLinkAddress(at(expiry.subtract({ seconds: 1 })), token)).toBe(email);
    expect(await signUpLinkAddress(at(expiry), token)).toBeNull();
    expect(await signUpLinkAddress(context, 'made-up')).toBeNull();
    expect(await signUpLinkAddress(context, undefined)).toBeNull();
    expect(await signUpLinkAddress(context, 'x'.repeat(257))).toBeNull();
  });

  it('stores only its token’s hash (SEC-7)', async () => {
    const email = newAddress();
    const { token } = await signUpLink(email);
    const rows = await test.context.db
      .select({ identifier: verifications.identifier })
      .from(verifications)
      .where(eq(verifications.value, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).not.toContain(token);
  });

  it('replaces the link sent before it to the same address (ADR-0014 §7)', async () => {
    const email = newAddress();
    const first = await signUpLink(email);
    const second = await signUpLink(email);
    expect(await signUpLinkAddress(context, first.token)).toBeNull();
    expect(await signUpLinkAddress(context, second.token)).toBe(email);
  });

  it('isn’t sent once the address has an account, and its e-mail is dropped', async () => {
    const email = newAddress();
    await requestSignUp(context, { email }, client);
    const [row] = await waiting(email);
    await createTestAccount(test.context.auth, { email, password: 'correct horse battery' });
    expect(await prepareAccountEmail(test.context, row?.id ?? '')).toBeNull();
    expect(await waiting(email)).toEqual([]);
  });

  it('is deleted 7 days after it expired (ADR-0012 §5, clarification)', async () => {
    const email = newAddress();
    await signUpLink(email);
    const expiry = await expiryOf(email);
    const remaining = () =>
      test.context.db.select().from(verifications).where(eq(verifications.value, email));
    await deleteExpiredSignUpLinks(at(expiry.add({ hours: 7 * 24 })));
    expect(await remaining()).toHaveLength(1);
    await deleteExpiredSignUpLinks(at(expiry.add({ hours: 7 * 24, seconds: 1 })));
    expect(await remaining()).toEqual([]);
  });
});
