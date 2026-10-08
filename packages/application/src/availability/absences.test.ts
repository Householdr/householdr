import { absences, accounts, inHousehold, members, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import type { Member, Role } from '@householdr/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from '../households/create-household';
import { membership, type HouseholdContext } from '../households/membership';
import { settableClock } from '../testing';
import { addAbsence, removeAbsence, viewAvailability } from './absences';

// Planned absences (ADR-0005 §2), who may manage them (ADR-0018 §3–§4, ADR-0010 §7) and what the
// household sees of them, on a real database (TEST-11) with a clock the tests set (TEST-2).

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

/** 08:00 in Brussels on Thursday 8 October 2026. */
const thursday = Temporal.Instant.from('2026-10-08T06:00:00Z');

/**
 * A household in Brussels, founded by Robin, its head (with two factors unless said), and the
 * context Robin acts in, at `now`.
 */
const founded = async ({ twoFactor = true, now = thursday } = {}) => {
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
  const { householdId } = result;
  const clock = settableClock(now);
  const as = async (accountId: string): Promise<HouseholdContext> => {
    const member = await membership({ db }, accountId, householdId);
    if (!member) throw new Error('Not a member');
    return { db, clock, householdId, member };
  };

  /** Adds a profile, linked to a new account when `withAccount`; returns its id and context. */
  const add = async (name: string, role: Role, withAccount: boolean) => {
    const accountId = withAccount ? await newAccount() : null;
    const [row] = await inHousehold(db, householdId, (tx) =>
      tx
        .insert(members)
        .values({
          householdId,
          name,
          role,
          accountId,
          birthDate: role === 'child' ? '2014-05-01' : null,
        })
        .returning({ id: members.id }),
    );
    if (!row) throw new Error('No member');
    return { id: row.id, context: accountId ? await as(accountId) : null };
  };
  return { householdId, clock, head: await as(account), add };
};

/** A member's context, which the test knows they have. */
const signedIn = ({ context }: { context: HouseholdContext | null }) => {
  if (!context) throw new Error('A profile without an account');
  return context;
};

const days = (member: string, firstDay: string, lastDay: string) => ({
  member,
  firstDay,
  lastDay,
});

/** The absences stored in household `householdId`, as whose and which days. */
const stored = (householdId: string) =>
  inHousehold(db, householdId, (tx) =>
    tx
      .select({ member: absences.memberId, from: absences.firstDay, to: absences.lastDay })
      .from(absences)
      .orderBy(absences.firstDay),
  );

/** What `context` sees: each member's name, and their absences as `from/to`. */
const seen = async (context: HouseholdContext) => {
  const view = await viewAvailability(context);
  if (!view.ok) return view;
  return view.members.map((m) => ({
    name: m.name,
    away: m.absences.map((a) => `${a.from.toString()}/${a.to.toString()}`),
    mayManage: m.mayManage,
  }));
};

describe('addAbsence (ADR-0005 §2)', () => {
  it('plans a member’s own absence, which everyone in the household then sees', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const result = await addAbsence(signedIn(alex), days(alex.id, '2026-10-12', '2026-10-16'));
    expect(result).toEqual({ ok: true, absenceId: expect.any(String) as string });
    expect(await stored(household.householdId)).toEqual([
      { member: alex.id, from: '2026-10-12', to: '2026-10-16' },
    ]);
    expect(await seen(household.head)).toEqual([
      { name: 'Robin', away: [], mayManage: true },
      { name: 'Alex', away: ['2026-10-12/2026-10-16'], mayManage: false },
    ]);
  });

  it('lets a head plan for children and for profiles without an account (ADR-0018 §4)', async () => {
    const household = await founded();
    const kim = await household.add('Kim', 'child', true);
    const noa = await household.add('Noa', 'child', false);
    const sam = await household.add('Sam', 'adult', false);
    for (const member of [household.head.member.id, kim.id, noa.id, sam.id]) {
      expect(await addAbsence(household.head, days(member, '2026-10-12', '2026-10-13'))).toEqual({
        ok: true,
        absenceId: expect.any(String) as string,
      });
    }
    expect(await stored(household.householdId)).toHaveLength(4);
  });

  it('lets a child with an account plan their own, as heads can too (ADR-0010 §7)', async () => {
    const household = await founded();
    const kim = await household.add('Kim', 'child', true);
    expect(await addAbsence(signedIn(kim), days(kim.id, '2026-10-12', '2026-10-13'))).toMatchObject(
      { ok: true },
    );
  });

  it('refuses a head for another adult with an account, or another head (ADR-0018 §4)', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const jo = await household.add('Jo', 'head', true);
    for (const member of [alex.id, jo.id]) {
      expect(await addAbsence(household.head, days(member, '2026-10-12', '2026-10-13'))).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await stored(household.householdId)).toEqual([]);
  });

  it('refuses a head without two factors for anyone but themselves (ADR-0010 §3)', async () => {
    const household = await founded({ twoFactor: false });
    const kim = await household.add('Kim', 'child', false);
    expect(await addAbsence(household.head, days(kim.id, '2026-10-12', '2026-10-13'))).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    const own = days(household.head.member.id, '2026-10-12', '2026-10-13');
    expect(await addAbsence(household.head, own)).toMatchObject({ ok: true });
  });

  it('refuses an adult, or a child, for anyone else, with an account or without', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const kim = await household.add('Kim', 'child', true);
    const others = [
      household.head.member.id,
      (await household.add('Noa', 'child', false)).id,
      (await household.add('Sam', 'adult', false)).id,
      (await household.add('Jo', 'adult', true)).id,
    ];
    for (const actor of [alex, kim]) {
      for (const member of [...others, actor === alex ? kim.id : alex.id]) {
        expect(await addAbsence(signedIn(actor), days(member, '2026-10-12', '2026-10-13'))).toEqual(
          { ok: false, error: 'not-allowed' },
        );
      }
    }
    expect(await stored(household.householdId)).toEqual([]);
  });

  it('finds no member of another household, and writes nothing there', async () => {
    const ash = await founded();
    const birch = await founded();
    const kim = await ash.add('Kim', 'child', false);
    for (const member of [kim.id, ash.head.member.id]) {
      expect(await addAbsence(birch.head, days(member, '2026-10-12', '2026-10-13'))).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    expect(await addAbsence(birch.head, days('Kim', '2026-10-12', '2026-10-13'))).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await stored(ash.householdId)).toEqual([]);
    expect(await stored(birch.householdId)).toEqual([]);
  });

  it('refuses a profile without an account, which can’t act (ADR-0018 §4)', async () => {
    const household = await founded();
    const profile: Member = { ...household.head.member, hasAccount: false };
    const own = days(profile.id, '2026-10-12', '2026-10-13');
    expect(await addAbsence({ ...household.head, member: profile }, own)).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('needs two real days, the last not before the first (CODE-12)', async () => {
    const household = await founded();
    const me = household.head.member.id;
    const refused = async (firstDay: unknown, lastDay: unknown) => {
      const result = await addAbsence(household.head, { member: me, firstDay, lastDay });
      return result.ok ? [] : 'fields' in result ? result.fields : result.error;
    };
    expect(await refused('2026-10-16', '2026-10-12')).toEqual(['lastDay']);
    expect(await refused('2026-10-13', '2026-10-12')).toEqual(['lastDay']);
    expect(await refused('2026-02-30', '2026-10-12')).toEqual(['firstDay']);
    expect(await refused('12/10/2026', '2026-10-13')).toEqual(['firstDay']);
    expect(await refused('2026-10-12', '2026-10-12T10:00')).toEqual(['lastDay']);
    expect(await refused('', '')).toEqual(['firstDay', 'lastDay']);
    expect(await refused(undefined, 20261013)).toEqual(['firstDay', 'lastDay']);
    // Every problem at once, so nothing is fixed only to find another.
    expect(await refused('2026-10-01', '')).toEqual(['firstDay', 'lastDay']);
    expect(await refused('', '2026-10-01')).toEqual(['firstDay', 'lastDay']);
    expect(await stored(household.householdId)).toEqual([]);
    expect(await refused('2026-10-12', '2026-10-12')).toEqual([]);
  });

  it('plans from the household’s today, in its time zone, to a year ahead', async () => {
    // 00:30 on Friday 9 October in Brussels, still Thursday in UTC.
    const household = await founded({ now: Temporal.Instant.from('2026-10-08T22:30:00Z') });
    const me = household.head.member.id;
    const refused = async (firstDay: string, lastDay: string) => {
      const result = await addAbsence(household.head, days(me, firstDay, lastDay));
      return result.ok ? [] : 'fields' in result ? result.fields : result.error;
    };
    expect(await refused('2026-10-08', '2026-10-10')).toEqual(['firstDay']);
    expect(await refused('2026-10-01', '2026-10-07')).toEqual(['firstDay', 'lastDay']);
    expect(await refused('2026-10-09', '2026-10-09')).toEqual([]);
    expect(await refused('2027-10-09', '2027-10-09')).toEqual([]);
    expect(await refused('2027-10-09', '2027-10-10')).toEqual(['lastDay']);
    expect(await refused('2027-10-10', '2027-10-11')).toEqual(['firstDay', 'lastDay']);
  });

  it('keeps absences that overlap, as the domain takes their union', async () => {
    const household = await founded();
    const me = household.head.member.id;
    await addAbsence(household.head, days(me, '2026-10-12', '2026-10-16'));
    await addAbsence(household.head, days(me, '2026-10-14', '2026-10-20'));
    await addAbsence(household.head, days(me, '2026-10-14', '2026-10-20'));
    expect(await seen(household.head)).toEqual([
      {
        name: 'Robin',
        away: ['2026-10-12/2026-10-16', '2026-10-14/2026-10-20', '2026-10-14/2026-10-20'],
        mayManage: true,
      },
    ]);
  });
});

describe('removeAbsence (ADR-0005 §2)', () => {
  /** Plans an absence as `context` and returns its id. */
  const planned = async (context: HouseholdContext, member: string, from: string, to: string) => {
    const result = await addAbsence(context, days(member, from, to));
    if (!result.ok) throw new Error(`Not planned: ${result.error}`);
    return result.absenceId;
  };

  it('removes a member’s own absence, and a head removes a child’s', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const noa = await household.add('Noa', 'child', false);
    const own = await planned(signedIn(alex), alex.id, '2026-10-12', '2026-10-16');
    const child = await planned(household.head, noa.id, '2026-10-12', '2026-10-16');
    expect(await removeAbsence(signedIn(alex), { absence: own })).toEqual({ ok: true });
    expect(await removeAbsence(household.head, { absence: child })).toEqual({ ok: true });
    expect(await stored(household.householdId)).toEqual([]);
  });

  it('refuses whoever may not manage it, and keeps it (ADR-0018 §4)', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const kim = await household.add('Kim', 'child', true);
    const alexs = await planned(signedIn(alex), alex.id, '2026-10-12', '2026-10-16');
    const kims = await planned(signedIn(kim), kim.id, '2026-10-12', '2026-10-16');
    expect(await removeAbsence(household.head, { absence: alexs })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await removeAbsence(signedIn(alex), { absence: kims })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await removeAbsence(signedIn(kim), { absence: alexs })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await stored(household.householdId)).toHaveLength(2);
    expect(await removeAbsence(household.head, { absence: kims })).toEqual({ ok: true });
  });

  it('finds nothing of another household, already removed, or over', async () => {
    const ash = await founded();
    const birch = await founded();
    const theirs = await planned(ash.head, ash.head.member.id, '2026-10-08', '2026-10-09');
    expect(await removeAbsence(birch.head, { absence: theirs })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await stored(ash.householdId)).toHaveLength(1);
    // Saturday 10 October in Brussels: it ended yesterday.
    ash.clock.advance({ hours: 48 });
    expect(await removeAbsence(ash.head, { absence: theirs })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await stored(ash.householdId)).toHaveLength(1);
    const later = await planned(ash.head, ash.head.member.id, '2026-10-12', '2026-10-13');
    expect(await removeAbsence(ash.head, { absence: later })).toEqual({ ok: true });
    expect(await removeAbsence(ash.head, { absence: later })).toEqual({
      ok: false,
      error: 'not-found',
    });
    for (const absence of [crypto.randomUUID(), 'x', undefined]) {
      expect(await removeAbsence(ash.head, { absence })).toEqual({ ok: false, error: 'not-found' });
    }
  });
});

describe('viewAvailability (ADR-0018 §3)', () => {
  it('shows every member’s current and upcoming absences by first day, and whom the viewer manages', async () => {
    const household = await founded();
    const alex = await household.add('Alex', 'adult', true);
    const kim = await household.add('Kim', 'child', true);
    const sam = await household.add('Sam', 'adult', false);
    await addAbsence(signedIn(alex), days(alex.id, '2026-12-21', '2027-01-03'));
    await addAbsence(signedIn(alex), days(alex.id, '2026-10-08', '2026-10-09'));
    await addAbsence(household.head, days(kim.id, '2026-10-20', '2026-10-20'));
    expect(await seen(household.head)).toEqual([
      { name: 'Robin', away: [], mayManage: true },
      { name: 'Alex', away: ['2026-10-08/2026-10-09', '2026-12-21/2027-01-03'], mayManage: false },
      { name: 'Sam', away: [], mayManage: true },
      { name: 'Kim', away: ['2026-10-20/2026-10-20'], mayManage: true },
    ]);
    // Another adult sees the same dates, and manages only themselves.
    expect(await seen(signedIn(alex))).toEqual([
      { name: 'Robin', away: [], mayManage: false },
      { name: 'Alex', away: ['2026-10-08/2026-10-09', '2026-12-21/2027-01-03'], mayManage: true },
      { name: 'Sam', away: [], mayManage: false },
      { name: 'Kim', away: ['2026-10-20/2026-10-20'], mayManage: false },
    ]);
    expect(sam.context).toBeNull();
  });

  it('shows an absence until its last day is over in the household, then no more', async () => {
    const household = await founded();
    const me = household.head.member.id;
    await addAbsence(household.head, days(me, '2026-10-08', '2026-10-09'));
    // 23:30 on Friday 9 October in Brussels, its last day.
    household.clock.advance({ hours: 39, minutes: 30 });
    expect(await seen(household.head)).toMatchObject([{ away: ['2026-10-08/2026-10-09'] }]);
    household.clock.advance({ minutes: 30 });
    expect(await seen(household.head)).toMatchObject([{ away: [] }]);
    // Kept as the membership's record, not shown (ADR-0012 §5).
    expect(await stored(household.householdId)).toHaveLength(1);
  });

  it('gives the days a new absence can fall on', async () => {
    const view = await viewAvailability((await founded()).head);
    expect(view.ok && [view.plannable.from.toString(), view.plannable.to.toString()]).toEqual([
      '2026-10-08',
      '2027-10-08',
    ]);
  });

  it('shows nothing to a profile without an account, which can’t act (ADR-0018 §4)', async () => {
    const household = await founded();
    const profile: Member = { ...household.head.member, hasAccount: false };
    expect(await viewAvailability({ ...household.head, member: profile })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });
});
