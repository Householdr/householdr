import {
  accounts,
  inHousehold,
  members,
  parentalConsents,
  passkeys,
  profileGuardians,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settableClock } from '../testing';
import { addChild } from './add-child';
import { createHousehold } from './create-household';
import { membership, viewHousehold } from './membership';

// Adding a child's profile with parental consent (ADR-0007 §2, ADR-0010 §9), on a real database
// (TEST-11), on fixed dates (TEST-2).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
const newAccount = async () => {
  const [row] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  return row.id;
};

/** Gives the account a passkey, its second factor (ADR-0010 §3). */
const addPasskey = (userId: string) =>
  db.insert(passkeys).values({
    userId,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });

const consentText = {
  text: 'I have parental responsibility for this child, and I agree to them using Householdr.',
  language: 'en',
};

/**
 * A household in Brussels and its founding head, as the guard finds them, with two factors unless
 * said, at 10:00 on 8 October 2026 there unless said: what adding a child needs.
 */
const founded = async ({ twoFactor = true, now = '2026-10-08T08:00:00Z' } = {}) => {
  const account = await newAccount();
  if (twoFactor) await addPasskey(account);
  const result = await createHousehold(
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
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account, result.householdId);
  if (!member) throw new Error('Not a member');
  const clock = settableClock(Temporal.Instant.from(now));
  return { db, clock, consentText, householdId: result.householdId, member, account };
};

/** Everything adding a child writes in household `householdId`. */
const writtenIn = (householdId: string) =>
  inHousehold(db, householdId, async (tx) => ({
    children: await tx
      .select({
        id: members.id,
        name: members.name,
        birthDate: members.birthDate,
        accountId: members.accountId,
      })
      .from(members)
      .where(eq(members.role, 'child')),
    guardians: await tx
      .select({ memberId: profileGuardians.memberId, accountId: profileGuardians.accountId })
      .from(profileGuardians),
    consents: await tx
      .select({
        memberId: parentalConsents.memberId,
        givenBy: parentalConsents.givenBy,
        givenAt: parentalConsents.givenAt,
        text: parentalConsents.text,
        language: parentalConsents.language,
      })
      .from(parentalConsents),
  }));
const nothing = { children: [], guardians: [], consents: [] };

const kim = { name: 'Kim', birthDate: '2016-03-01', consent: true };

describe('addChild (ADR-0007 §2, ADR-0010 §9)', () => {
  it('adds the profile, with the head as its first guardian and their consent kept', async () => {
    const head = await founded();
    const result = await addChild(head, { ...kim, name: '  Kim  ' });
    expect(result).toEqual({ ok: true, memberId: expect.any(String) as string, name: 'Kim' });
    if (!result.ok) return;
    expect(await writtenIn(head.householdId)).toEqual({
      children: [{ id: result.memberId, name: 'Kim', birthDate: '2016-03-01', accountId: null }],
      guardians: [{ memberId: result.memberId, accountId: head.account }],
      consents: [
        {
          memberId: result.memberId,
          givenBy: head.account,
          givenAt: new Date('2026-10-08T08:00:00Z'),
          ...consentText,
        },
      ],
    });
  });

  it('keeps the consent in the words and language the head was shown', async () => {
    const shown = {
      text: 'Ik heb het ouderlijk gezag over dit kind, en ik ga ermee akkoord dat het Householdr gebruikt.',
      language: 'nl',
    };
    const head = await founded();
    head.clock.advance({ minutes: 5 });
    expect(await addChild({ ...head, consentText: shown }, kim)).toMatchObject({ ok: true });
    const { consents } = await writtenIn(head.householdId);
    expect(consents).toMatchObject([{ givenAt: new Date('2026-10-08T08:05:00Z'), ...shown }]);
  });

  it('lists the child after the adults, without their birth date (ADR-0012 §3)', async () => {
    const head = await founded();
    const added = await addChild(head, kim);
    if (!added.ok) throw new Error('Not added');
    expect(await viewHousehold(head)).toEqual({
      ok: true,
      name: 'Ash Lane',
      members: [
        {
          id: head.member.id,
          name: 'Robin',
          role: 'head',
          account: null,
          invitable: false,
          invitationExpiresAt: null,
        },
        {
          id: added.memberId,
          name: 'Kim',
          role: 'child',
          account: null,
          invitable: false,
          invitationExpiresAt: null,
        },
      ],
      mayAddMembers: true,
      mayChangeSettings: true,
    });
  });

  it('keeps nothing if any of it can’t be written: it is one transaction', async () => {
    const head = await founded();
    // An empty text is refused by the database, after the profile and guardian are written.
    const unshown = { ...head, consentText: { text: '', language: 'en' } };
    await expect(addChild(unshown, kim)).rejects.toThrow();
    expect(await writtenIn(head.householdId)).toEqual(nothing);
  });

  it('refuses without the head’s consent, which is never assumed', async () => {
    const head = await founded();
    for (const consent of [false, undefined, 'on', 'true', 1, null]) {
      expect(await addChild(head, { ...kim, consent })).toEqual({
        ok: false,
        error: 'invalid',
        problems: ['consent'],
      });
    }
    expect(await writtenIn(head.householdId)).toEqual(nothing);
  });

  it('needs a real birth date, no later than the household’s today', async () => {
    const head = await founded();
    const invalid = { ok: false, error: 'invalid', problems: ['birthDate'] };
    for (const birthDate of [
      '',
      '2016-02-30',
      '2016-3-1',
      '01/03/2016',
      '2016-03-01T00:00',
      '+002016-03-01',
      20160301,
      undefined,
      // Tomorrow in Brussels.
      '2026-10-09',
    ]) {
      expect(await addChild(head, { ...kim, birthDate })).toEqual(invalid);
    }
    expect(await writtenIn(head.householdId)).toEqual(nothing);
    // Born today: a newborn.
    expect(await addChild(head, { ...kim, birthDate: '2026-10-08' })).toMatchObject({ ok: true });
  });

  it('is for children: from their 18th birthday, someone is an adult (ADR-0010 §7)', async () => {
    const head = await founded();
    expect(await addChild(head, { ...kim, birthDate: '2008-10-08' })).toEqual({
      ok: false,
      error: 'invalid',
      problems: ['adult'],
    });
    expect(await addChild(head, { ...kim, birthDate: '1990-01-01' })).toMatchObject({
      problems: ['adult'],
    });
    expect(await writtenIn(head.householdId)).toEqual(nothing);
    expect(await addChild(head, { ...kim, birthDate: '2008-10-09' })).toMatchObject({ ok: true });
  });

  it('counts a 29 February birthday from 1 March (ADR-0001 §4, clarification)', async () => {
    const head = await founded({ now: '2026-02-28T12:00:00Z' });
    const leapDay = { ...kim, birthDate: '2008-02-29' };
    expect(await addChild(head, leapDay)).toMatchObject({ ok: true });
    head.clock.advance({ hours: 24 });
    expect(await addChild(head, leapDay)).toMatchObject({ problems: ['adult'] });
  });

  it('goes by the household’s date, in its time zone', async () => {
    // 00:30 on 9 October in Brussels, while it is still 8 October in UTC.
    const head = await founded({ now: '2026-10-08T22:30:00Z' });
    expect(await addChild(head, { ...kim, birthDate: '2008-10-09' })).toMatchObject({
      problems: ['adult'],
    });
    expect(await addChild(head, { ...kim, birthDate: '2026-10-09' })).toMatchObject({ ok: true });
  });

  it('names every problem at once', async () => {
    const head = await founded();
    expect(await addChild(head, { name: '  ', birthDate: 'soon', consent: false })).toEqual({
      ok: false,
      error: 'invalid',
      problems: ['name', 'birthDate', 'consent'],
    });
    expect(
      await addChild(head, { ...kim, name: 'x'.repeat(101), birthDate: '2000-01-01' }),
    ).toEqual({ ok: false, error: 'invalid', problems: ['name', 'adult'] });
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const notAllowed = { ok: false, error: 'not-allowed' };
    const withoutTwoFactor = await founded({ twoFactor: false });
    expect(await addChild(withoutTwoFactor, kim)).toEqual(notAllowed);
    const head = await founded();
    for (const member of [
      { ...head.member, role: 'adult' as const },
      { ...head.member, role: 'child' as const },
      { ...head.member, hasAccount: false },
    ]) {
      expect(await addChild({ ...head, member }, kim)).toEqual(notAllowed);
    }
    expect(await writtenIn(withoutTwoFactor.householdId)).toEqual(nothing);
    expect(await writtenIn(head.householdId)).toEqual(nothing);
  });

  it('keeps the profile, its guardian and the consent within the household (TEST-4)', async () => {
    const head = await founded();
    const other = await founded();
    expect(await addChild(head, kim)).toMatchObject({ ok: true });
    expect(await writtenIn(other.householdId)).toEqual(nothing);
  });
});
