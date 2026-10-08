import { accounts, inHousehold, invitations, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settableClock } from '../testing';
import { addAdult } from './add-adult';
import { createHousehold } from './create-household';
import { acceptInvitation, invite, openInvitation, revokeInvitation } from './invitations';
import { membership, viewHousehold } from './membership';

// Invitation links (ADR-0010 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
/** A new account, its address confirmed unless said otherwise. */
const newAccount = async (emailVerified = true) => {
  const [row] = await db
    .insert(accounts)
    .values({
      name: 'Sam',
      email: `sam-${String(++next)}@example.org`,
      emailVerified,
      culture: 'en-BE',
    })
    .returning({ id: accounts.id, email: accounts.email });
  if (!row) throw new Error('No account');
  return row;
};

/** A household whose head has two factors, with Kim's adult profile; all at a clock of its own. */
const household = async () => {
  const { id: account } = await newAccount();
  await db.insert(passkeys).values({
    userId: account,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const created = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
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
  if (!created.ok) throw new Error(`Not created: ${created.error}`);
  const member = await membership({ db }, account, created.householdId);
  if (!member) throw new Error('Not a member');
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  const head = { db, clock, householdId: created.householdId, member };
  const kim = await addAdult(head, { name: 'Kim' });
  if (!kim.ok) throw new Error('No profile');
  return { head, account, kim: kim.memberId, clock };
};

/** A link for Kim's profile, made by the head. */
const linkFor = async (head: Awaited<ReturnType<typeof household>>['head'], member: string) => {
  const result = await invite(head, { member });
  if (!result.ok) throw new Error(`No link: ${result.error}`);
  return result;
};

describe('invite (ADR-0010 §5)', () => {
  it('makes a single link of 43 random characters for 7 days, and keeps only its hash', async () => {
    const { head, kim, clock } = await household();
    const { token, expiresAt } = await linkFor(head, kim);
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(expiresAt).toEqual(clock.now().add({ hours: 168 }));
    const stored = await inHousehold(db, head.householdId, (tx) => tx.select().from(invitations));
    expect(stored).toEqual([
      {
        memberId: kim,
        householdId: head.householdId,
        tokenHash: expect.not.stringContaining(token) as string,
        expiresAt: new Date('2026-10-15T08:00:00Z'),
      },
    ]);
  });

  it('replaces the profile’s link with a new one, and the old one stops working', async () => {
    const { head, kim } = await household();
    const first = await linkFor(head, kim);
    const second = await linkFor(head, kim);
    const context = { db, clock: head.clock };
    expect(await openInvitation(context, first.token)).toBeNull();
    expect(await openInvitation(context, second.token)).toEqual({
      household: 'Ash Lane',
      profile: 'Kim',
    });
  });

  it('is for a head with two factors, and an adult’s profile without an account', async () => {
    const { head, kim } = await household();
    const withoutTwoFactor = { ...head, member: { ...head.member, twoFactor: false } };
    expect(await invite(withoutTwoFactor, { member: kim })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    // The head's own profile has an account; the others aren't profiles of this household.
    const other = await household();
    for (const member of [head.member.id, other.kim, crypto.randomUUID(), 'kim', undefined]) {
      expect(await invite(head, { member })).toEqual({ ok: false, error: 'not-found' });
    }
  });
});

describe('revokeInvitation (ADR-0010 §5)', () => {
  it('stops the link working, for heads only', async () => {
    const { head, kim } = await household();
    const { token } = await linkFor(head, kim);
    const adult = { ...head, member: { ...head.member, role: 'adult' as const } };
    expect(await revokeInvitation(adult, { member: kim })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await openInvitation({ db, clock: head.clock }, token)).not.toBeNull();
    expect(await revokeInvitation(head, { member: kim })).toEqual({ ok: true });
    expect(await openInvitation({ db, clock: head.clock }, token)).toBeNull();
  });
});

describe('openInvitation (ADR-0010 §5)', () => {
  it('shows what a link invites to until it expires after 7 days', async () => {
    const { head, kim, clock } = await household();
    const { token } = await linkFor(head, kim);
    const context = { db, clock };
    clock.advance({ seconds: 168 * 3600 - 1 });
    expect(await openInvitation(context, token)).toEqual({ household: 'Ash Lane', profile: 'Kim' });
    clock.advance({ seconds: 1 });
    expect(await openInvitation(context, token)).toBeNull();
  });

  it('shows nothing for a token that isn’t a link’s', async () => {
    const context = { db, clock: settableClock(Temporal.Now.instant()) };
    for (const token of [undefined, '', 'x'.repeat(43), "' or 1=1 --", 42, 'x'.repeat(10_000)]) {
      expect(await openInvitation(context, token)).toBeNull();
    }
  });
});

describe('acceptInvitation (ADR-0010 §5)', () => {
  it('links the account to the profile, uses up the link, and shows heads who accepted', async () => {
    const { head, kim, clock } = await household();
    const { token } = await linkFor(head, kim);
    const sam = await newAccount();
    const context = { db, clock };
    expect(await acceptInvitation(context, sam.id, token)).toEqual({
      ok: true,
      householdId: head.householdId,
    });
    expect(await membership({ db }, sam.id, head.householdId)).toMatchObject({
      id: kim,
      role: 'adult',
      hasAccount: true,
    });
    expect(await openInvitation(context, token)).toBeNull();
    expect(await acceptInvitation(context, (await newAccount()).id, token)).toEqual({
      ok: false,
      error: 'expired',
    });
    // The profile keeps its name; heads see the account behind it, others don't (ADR-0012 §3).
    const view = await viewHousehold(head);
    expect(view).toMatchObject({
      members: [
        { role: 'head', account: null },
        { id: kim, name: 'Kim', account: { name: 'Sam', email: sam.email }, invitable: false },
      ],
    });
    const samsMember = await membership({ db }, sam.id, head.householdId);
    if (!samsMember) throw new Error('Not a member');
    const samsView = await viewHousehold({ ...head, member: samsMember });
    expect(samsView).toMatchObject({ members: [{ account: null }, { account: null }] });
  });

  it('turns away an account already in the household, which keeps the link working', async () => {
    const { head, kim, account } = await household();
    const { token } = await linkFor(head, kim);
    const context = { db, clock: head.clock };
    expect(await acceptInvitation(context, account, token)).toEqual({ ok: false, error: 'member' });
    expect(await openInvitation(context, token)).not.toBeNull();
  });

  it('needs a confirmed e-mail address (ADR-0010 §1)', async () => {
    const { head, kim } = await household();
    const { token } = await linkFor(head, kim);
    const unverified = await newAccount(false);
    expect(await acceptInvitation({ db, clock: head.clock }, unverified.id, token)).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('turns away an expired link, and lets only one of two people accepting at once in', async () => {
    const { head, kim, clock } = await household();
    const { token } = await linkFor(head, kim);
    const [sam, alex] = [await newAccount(), await newAccount()];
    const results = await Promise.all(
      [sam, alex].map(({ id }) => acceptInvitation({ db, clock }, id, token)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'expired' }]);

    const other = await household();
    const late = await linkFor(other.head, other.kim);
    other.clock.advance({ hours: 168 });
    expect(await acceptInvitation({ db, clock: other.clock }, sam.id, late.token)).toEqual({
      ok: false,
      error: 'expired',
    });
  });
});

describe('viewHousehold, for invitations (ADR-0010 §5)', () => {
  it('shows a head which profiles they may invite and when a live link stops working', async () => {
    const { head, kim, clock } = await household();
    expect(await viewHousehold(head)).toMatchObject({
      members: [
        { role: 'head', invitable: false, invitationExpiresAt: null },
        { id: kim, invitable: true, invitationExpiresAt: null },
      ],
    });
    const { expiresAt } = await linkFor(head, kim);
    expect(await viewHousehold(head)).toMatchObject({
      members: [{}, { id: kim, invitationExpiresAt: expiresAt }],
    });
    clock.advance({ hours: 168 });
    expect(await viewHousehold(head)).toMatchObject({
      members: [{}, { id: kim, invitationExpiresAt: null }],
    });
    const adult = { ...head, member: { ...head.member, role: 'adult' as const } };
    expect(await viewHousehold(adult)).toMatchObject({
      members: [{}, { id: kim, invitable: false, invitationExpiresAt: null }],
    });
  });
});
