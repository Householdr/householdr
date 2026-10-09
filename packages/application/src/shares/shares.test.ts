import {
  accounts,
  activityLog,
  inHousehold,
  members,
  passkeys,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { asc, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { householdActivity } from '../households/activity';
import { createHousehold } from '../households/create-household';
import { membership, type HouseholdContext } from '../households/membership';
import { startHousehold } from '../households/start-household';
import { settableClock } from '../testing';
import { changeShare, householdShares } from './shares';
import { addTemporaryShare, removeTemporaryShare } from './temporary-shares';

// Heads set members' shares (ADR-0001 §4), seen by the member and the heads only (ADR-0018 §4),
// from the version they saw (ADR-0019 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

const newAccount = async (name: string) => {
  const [account] = await db
    .insert(accounts)
    .values({ name, email: `${name}-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  return account.id;
};

/**
 * A household founded by Robin, a head with two factors, with Alex, an adult with an account, Sam,
 * a profile without one, and Kim, a child born on Monday 12 October 2018. Monday 12 October 2026 is
 * Kim's 8th birthday, and the household's weeks start on Mondays in Brussels.
 */
const household = async (now = '2026-10-08T08:00:00Z') => {
  const robin = await newAccount('robin');
  await db.insert(passkeys).values({
    userId: robin,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const created = await createHousehold(
    {
      db,
      actor: { account: robin, twoFactor: true },
      account: { id: robin, managed: false, guardians: [] },
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
  const { householdId } = created;
  const alex = await newAccount('alex');
  const ids = await inHousehold(db, householdId, (tx) =>
    tx
      .insert(members)
      .values([
        { householdId, name: 'Alex', role: 'adult', accountId: alex },
        { householdId, name: 'Sam', role: 'adult' },
        { householdId, name: 'Kim', role: 'child', birthDate: '2018-10-12' },
      ])
      .returning({ id: members.id, name: members.name }),
  );
  const id = (name: string) => {
    const found = ids.find((member) => member.name === name);
    if (!found) throw new Error(`No ${name}`);
    return found.id;
  };
  const clock = settableClock(Temporal.Instant.from(now));
  const as = async (account: string): Promise<HouseholdContext> => {
    const member = await membership({ db }, account, householdId);
    if (!member) throw new Error('Not a member');
    return { db, clock, householdId, member };
  };
  const head = await as(robin);
  return {
    head,
    adult: await as(alex),
    clock,
    robin: head.member.id,
    alex: id('Alex'),
    sam: id('Sam'),
    kim: id('Kim'),
  };
};

const shareOf = async (context: HouseholdContext, member: string) => {
  const result = await householdShares(context);
  if (!result.ok) throw new Error('No shares');
  return result.shares.find((share) => share.id === member);
};

describe('householdShares (ADR-0001 §4, ADR-0018 §4)', () => {
  it('shows a head every share this plan week: a full one for adults, by age for children', async () => {
    const { head, robin, alex, sam, kim } = await household();
    expect(await householdShares(head)).toEqual({
      ok: true,
      shares: [
        {
          id: robin,
          name: 'Robin',
          role: 'head',
          percent: 100,
          set: null,
          temporary: [],
          temporaryThisWeek: false,
          version: 1,
        },
        {
          id: alex,
          name: 'Alex',
          role: 'adult',
          percent: 100,
          set: null,
          temporary: [],
          temporaryThisWeek: false,
          version: 1,
        },
        {
          id: sam,
          name: 'Sam',
          role: 'adult',
          percent: 100,
          set: null,
          temporary: [],
          temporaryThisWeek: false,
          version: 1,
        },
        // 7 on Monday 5 October, the week's first day: 0.1 + 3 × 0.9 / 14.
        {
          id: kim,
          name: 'Kim',
          role: 'child',
          percent: 29,
          set: null,
          temporary: [],
          temporaryThisWeek: false,
          version: 1,
        },
      ],
      mayChange: true,
      temporaryDays: { earliest: '2026-10-05', latest: '2027-10-08' },
    });
  });

  it('shows anyone else their own share only, which they can’t change', async () => {
    const { adult, alex } = await household();
    expect(await householdShares(adult)).toEqual({
      ok: true,
      shares: [
        {
          id: alex,
          name: 'Alex',
          role: 'adult',
          percent: 100,
          set: null,
          temporary: [],
          temporaryThisWeek: false,
          version: 1,
        },
      ],
      mayChange: false,
      temporaryDays: { earliest: '2026-10-05', latest: '2027-10-08' },
    });
  });

  it('moves a child’s share on at the week of their birthday, in the household’s time zone', async () => {
    // Sunday 23:30 in Brussels, then Monday 00:30: the week of Kim's 8th birthday.
    const { head, clock, kim } = await household('2026-10-11T21:30:00Z');
    expect(await shareOf(head, kim)).toMatchObject({ percent: 29 });
    clock.advance({ hours: 1 });
    // 0.1 + 4 × 0.9 / 14.
    expect(await shareOf(head, kim)).toMatchObject({ percent: 36 });
  });

  it('shows nothing to a profile without an account, which can’t act (ADR-0018 §4)', async () => {
    const { head } = await household();
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await householdShares(profile)).toEqual({ ok: false, error: 'not-allowed' });
  });
});

describe('changeShare (ADR-0001 §4, ADR-0019 §5)', () => {
  it('sets anyone’s share for a head, their own included, and puts it back to the default', async () => {
    const { head, robin, sam, kim } = await household();
    expect(await changeShare(head, { member: sam, percent: 50, version: 1 })).toEqual({
      ok: true,
      share: {
        id: sam,
        name: 'Sam',
        role: 'adult',
        percent: 50,
        set: 50,
        temporary: [],
        temporaryThisWeek: false,
        version: 2,
      },
    });
    expect(await changeShare(head, { member: kim, percent: 0, version: 1 })).toMatchObject({
      share: { percent: 0, set: 0, version: 2 },
    });
    expect(await changeShare(head, { member: robin, percent: 80, version: 1 })).toMatchObject({
      share: { percent: 80, set: 80, version: 2 },
    });
    expect(await changeShare(head, { member: kim, percent: null, version: 2 })).toMatchObject({
      share: { percent: 29, set: null, temporary: [], temporaryThisWeek: false, version: 3 },
    });
    expect(await shareOf(head, sam)).toEqual({
      id: sam,
      name: 'Sam',
      role: 'adult',
      percent: 50,
      set: 50,
      temporary: [],
      temporaryThisWeek: false,
      version: 2,
    });
  });

  it('keeps the version when nothing changes', async () => {
    const { head, sam } = await household();
    expect(await changeShare(head, { member: sam, percent: null, version: 1 })).toMatchObject({
      share: { set: null, temporary: [], temporaryThisWeek: false, version: 1 },
    });
  });

  it('saves nothing from a version that has moved on, and gives the share now', async () => {
    const { head, sam } = await household();
    await changeShare(head, { member: sam, percent: 50, version: 1 });
    expect(await changeShare(head, { member: sam, percent: 70, version: 1 })).toEqual({
      ok: false,
      error: 'conflict',
      current: {
        id: sam,
        name: 'Sam',
        role: 'adult',
        percent: 50,
        set: 50,
        temporary: [],
        temporaryThisWeek: false,
        version: 2,
      },
    });
    expect(await shareOf(head, sam)).toMatchObject({ set: 50 });
  });

  it('takes whole percents from none to a full share only', async () => {
    const { head, sam } = await household();
    for (const percent of [101, -1, 50.5, Number.NaN, '50', undefined]) {
      expect(await changeShare(head, { member: sam, percent, version: 1 })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    for (const version of [0, 1.5, '1', undefined]) {
      expect(await changeShare(head, { member: sam, percent: 50, version })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await shareOf(head, sam)).toMatchObject({
      set: null,
      temporary: [],
      temporaryThisWeek: false,
      version: 1,
    });
  });

  it('is for heads with two factors only (ADR-0010 §3), for themselves too', async () => {
    const { head, adult, alex, sam } = await household();
    const withoutTwoFactor = { ...head, member: { ...head.member, twoFactor: false } };
    for (const [someone, member] of [
      [adult, sam],
      [adult, alex],
      [withoutTwoFactor, sam],
    ] as const) {
      expect(await changeShare(someone, { member, percent: 50, version: 1 })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await shareOf(head, sam)).toMatchObject({ set: null });
    expect(await shareOf(head, alex)).toMatchObject({ set: null });
  });

  it('finds no member of another household, or by anything but an id', async () => {
    const { head } = await household();
    const other = await household();
    for (const member of [other.sam, 'Sam', undefined]) {
      expect(await changeShare(head, { member, percent: 50, version: 1 })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    const [sam] = await inHousehold(db, other.head.householdId, (tx) =>
      tx.select({ set: members.sharePercent }).from(members).where(eq(members.id, other.sam)),
    );
    expect(sam).toEqual({ set: null });
  });
});

describe('addTemporaryShare and removeTemporaryShare (ADR-0001 §4, clarifications)', () => {
  // Thursday 8 October 2026: this plan week runs from Monday 5 to Sunday 11 October.
  const nextWeek = { firstDay: '2026-10-12', lastDay: '2026-10-18' };

  it('plans a share ahead, which is the share on its days, both included', async () => {
    const { head, clock, sam } = await household();
    const added = await addTemporaryShare(head, { member: sam, ...nextWeek, percent: 50 });
    expect(added).toEqual({
      ok: true,
      share: {
        id: sam,
        name: 'Sam',
        role: 'adult',
        percent: 100,
        set: null,
        temporary: [{ id: expect.any(String) as unknown, ...nextWeek, percent: 50 }],
        temporaryThisWeek: false,
        version: 1,
      },
    });
    clock.advance({ hours: 4 * 24 });
    expect(await shareOf(head, sam)).toMatchObject({ percent: 50, temporaryThisWeek: true });
    clock.advance({ hours: 7 * 24 });
    // Once its week is over, it is no longer shown.
    expect(await shareOf(head, sam)).toMatchObject({ percent: 100, temporary: [] });
  });

  it('counts per day in a week it covers part of', async () => {
    const { head, sam } = await household();
    // Thursday to Sunday at none: 1 − 4/7 of a full share this week.
    await addTemporaryShare(head, {
      member: sam,
      firstDay: '2026-10-08',
      lastDay: '2026-10-11',
      percent: 0,
    });
    expect(await shareOf(head, sam)).toMatchObject({ percent: 43, temporaryThisWeek: true });
  });

  it('never overlaps another of the member’s, and says which', async () => {
    const { head, sam, alex } = await household();
    await addTemporaryShare(head, { member: sam, ...nextWeek, percent: 50 });
    expect(
      await addTemporaryShare(head, {
        member: sam,
        firstDay: '2026-10-18',
        lastDay: '2026-10-20',
        percent: 20,
      }),
    ).toEqual({
      ok: false,
      error: 'overlap',
      overlapping: { id: expect.any(String) as unknown, ...nextWeek, percent: 50 },
    });
    for (const days of [
      { firstDay: '2026-10-19', lastDay: '2026-10-20' },
      { firstDay: '2026-10-05', lastDay: '2026-10-11' },
    ]) {
      expect(await addTemporaryShare(head, { member: sam, ...days, percent: 20 })).toMatchObject({
        ok: true,
      });
    }
    // Another member's don't count.
    expect(await addTemporaryShare(head, { member: alex, ...nextWeek, percent: 20 })).toMatchObject(
      { ok: true },
    );
    expect(await shareOf(head, sam)).toMatchObject({
      temporary: [
        { firstDay: '2026-10-05', lastDay: '2026-10-11' },
        { firstDay: '2026-10-12', lastDay: '2026-10-18' },
        { firstDay: '2026-10-19', lastDay: '2026-10-20' },
      ],
    });
  });

  it('says which fields aren’t valid: days from this plan week up to a year on, in order', async () => {
    const { head, sam } = await household();
    const refused = (fields: object) =>
      addTemporaryShare(head, { member: sam, ...nextWeek, percent: 50, ...fields });
    for (const [fields, invalid] of [
      [{ lastDay: '2026-10-11' }, ['lastDay']],
      [{ firstDay: '2026-10-04' }, ['firstDay']],
      [{ lastDay: '2027-10-09' }, ['lastDay']],
      [{ firstDay: '2026-02-30' }, ['firstDay']],
      [{ percent: 101 }, ['percent']],
      [{ percent: 12.5 }, ['percent']],
      [
        { firstDay: undefined, lastDay: '', percent: Number.NaN },
        ['firstDay', 'lastDay', 'percent'],
      ],
    ] as const) {
      expect(await refused(fields)).toEqual({ ok: false, error: 'invalid', fields: invalid });
    }
    expect(await refused({ firstDay: '2026-10-05', lastDay: '2027-10-08' })).toMatchObject({
      ok: true,
    });
  });

  it('is for heads with two factors, and shown to the member themselves', async () => {
    const { head, adult, alex, sam } = await household();
    const withoutTwoFactor = { ...head, member: { ...head.member, twoFactor: false } };
    for (const [someone, member] of [
      [adult, sam],
      [adult, alex],
      [withoutTwoFactor, sam],
    ] as const) {
      expect(await addTemporaryShare(someone, { member, ...nextWeek, percent: 50 })).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    await addTemporaryShare(head, { member: alex, ...nextWeek, percent: 50 });
    await addTemporaryShare(head, { member: sam, ...nextWeek, percent: 50 });
    expect(await householdShares(adult)).toMatchObject({
      shares: [{ id: alex, temporary: [{ ...nextWeek, percent: 50 }] }],
    });
    const [planned] = (await shareOf(head, alex))?.temporary ?? [];
    if (!planned) throw new Error('No temporary share');
    expect(await removeTemporaryShare(adult, { id: planned.id })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await shareOf(head, alex)).toMatchObject({ temporary: [{ id: planned.id }] });
  });

  it('removes one for a head', async () => {
    const { head, sam } = await household();
    await addTemporaryShare(head, { member: sam, ...nextWeek, percent: 50 });
    const [planned] = (await shareOf(head, sam))?.temporary ?? [];
    if (!planned) throw new Error('No temporary share');
    expect(await removeTemporaryShare(head, { id: planned.id })).toMatchObject({
      ok: true,
      share: { id: sam, temporary: [] },
    });
    expect(await removeTemporaryShare(head, { id: planned.id })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('finds nothing of another household, or by anything but an id', async () => {
    const { head } = await household();
    const other = await household();
    for (const member of [other.sam, 'Sam', undefined]) {
      expect(await addTemporaryShare(head, { member, ...nextWeek, percent: 50 })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    await addTemporaryShare(other.head, { member: other.sam, ...nextWeek, percent: 50 });
    const [theirs] = (await shareOf(other.head, other.sam))?.temporary ?? [];
    if (!theirs) throw new Error('No temporary share');
    for (const id of [theirs.id, 'x', undefined]) {
      expect(await removeTemporaryShare(head, { id })).toEqual({ ok: false, error: 'not-found' });
    }
    expect(await shareOf(other.head, other.sam)).toMatchObject({ temporary: [{ id: theirs.id }] });
  });
});

/** Starts the household on the week start day, by Robin (ADR-0007 §2 step 7). */
const start = async (head: HouseholdContext) => {
  const result = await startHousehold(head, { when: 'week start' });
  if (!result.ok) throw new Error(`Not started: ${result.error}`);
};

/** The household's activity log as stored, whole rows, besides its start entry, oldest first. */
const logged = (head: HouseholdContext) =>
  inHousehold(db, head.householdId, (tx) =>
    tx
      .select()
      .from(activityLog)
      .where(ne(activityLog.action, 'household.started'))
      .orderBy(asc(activityLog.at)),
  );

describe('share changes in the activity log (ADR-0018 §5)', () => {
  // Thursday 8 October 2026: this plan week runs from Monday 5 to Sunday 11 October.
  const nextWeek = { firstDay: '2026-10-12', lastDay: '2026-10-18' };

  it('logs nothing before Start, whose entry lists them instead (ADR-0007 §2)', async () => {
    const { head, sam, kim } = await household();
    await changeShare(head, { member: sam, percent: 50, version: 1 });
    await addTemporaryShare(head, { member: kim, ...nextWeek, percent: 20 });
    const [planned] = (await shareOf(head, kim))?.temporary ?? [];
    if (!planned) throw new Error('No temporary share');
    await removeTemporaryShare(head, { id: planned.id });
    await addTemporaryShare(head, { member: kim, ...nextWeek, percent: 20 });
    expect(await logged(head)).toEqual([]);
    await start(head);
    expect(await householdActivity(head)).toMatchObject({
      entries: [{ action: 'household.started', setBeforeStart: { shares: ['Kim', 'Sam'] } }],
    });
  });

  it('logs each change after Start, saying whose and never a value', async () => {
    const { head, adult, clock, robin, sam, kim } = await household();
    await start(head);
    const at = (minutes: number) => {
      clock.advance({ minutes });
      return new Date(clock.now().epochMilliseconds);
    };
    const entry = (when: Date, action: string, subjectId: string) => ({
      id: expect.any(String) as string,
      householdId: head.householdId,
      at: when,
      actorId: robin,
      action,
      setBeforeStart: null,
      subjectId,
    });
    const first = at(1);
    await changeShare(head, { member: sam, percent: 50, version: 1 });
    // Back to the default is a change too.
    const second = at(1);
    await changeShare(head, { member: sam, percent: null, version: 2 });
    const third = at(1);
    await addTemporaryShare(head, { member: kim, ...nextWeek, percent: 20 });
    const [planned] = (await shareOf(head, kim))?.temporary ?? [];
    if (!planned) throw new Error('No temporary share');
    const fourth = at(1);
    await removeTemporaryShare(head, { id: planned.id });
    // A head's own share too (ADR-0018 §4).
    const fifth = at(1);
    await changeShare(head, { member: robin, percent: 80, version: 1 });
    expect(await logged(head)).toEqual([
      entry(first, 'share.changed', sam),
      entry(second, 'share.changed', sam),
      entry(third, 'temporary-share.added', kim),
      entry(fourth, 'temporary-share.removed', kim),
      entry(fifth, 'share.changed', robin),
    ]);
    // Every member sees them, by name (ADR-0018 §5), whoever's share it was.
    const shown = await householdActivity(adult);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.entries.map(({ actor, action, subject }) => [actor, action, subject])).toEqual([
      ['Robin', 'share.changed', 'Robin'],
      ['Robin', 'temporary-share.removed', 'Kim'],
      ['Robin', 'temporary-share.added', 'Kim'],
      ['Robin', 'share.changed', 'Sam'],
      ['Robin', 'share.changed', 'Sam'],
      ['Robin', 'household.started', null],
    ]);
  });

  it('logs nothing for a change that changes nothing, or isn’t made', async () => {
    const { head, adult, robin, sam, kim } = await household();
    await start(head);
    await changeShare(head, { member: sam, percent: 50, version: 1 });
    await addTemporaryShare(head, { member: kim, ...nextWeek, percent: 20 });
    const before = await logged(head);
    expect(before).toHaveLength(2);
    // The same share saved again, or the default kept.
    expect(await changeShare(head, { member: sam, percent: 50, version: 2 })).toMatchObject({
      ok: true,
      share: { version: 2 },
    });
    expect(await changeShare(head, { member: robin, percent: null, version: 1 })).toMatchObject({
      ok: true,
      share: { version: 1 },
    });
    // Refused: from a version gone, not valid, overlapping, or not a head's to make.
    expect(await changeShare(head, { member: sam, percent: 70, version: 1 })).toMatchObject({
      error: 'conflict',
    });
    expect(await changeShare(head, { member: sam, percent: 101, version: 2 })).toMatchObject({
      error: 'invalid',
    });
    expect(await addTemporaryShare(head, { member: kim, ...nextWeek, percent: 30 })).toMatchObject({
      error: 'overlap',
    });
    expect(await changeShare(adult, { member: sam, percent: 70, version: 2 })).toMatchObject({
      error: 'not-allowed',
    });
    const [planned] = (await shareOf(head, kim))?.temporary ?? [];
    if (!planned) throw new Error('No temporary share');
    expect(await removeTemporaryShare(adult, { id: planned.id })).toMatchObject({
      error: 'not-allowed',
    });
    expect(await logged(head)).toEqual(before);
  });
});
