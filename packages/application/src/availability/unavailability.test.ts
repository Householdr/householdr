import { accounts, members, unavailabilities, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import type { Role } from '@householdr/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { householdActivity } from '../households/activity';
import { membership, type HouseholdContext } from '../households/membership';
import { fairPortions } from '../plans/fair-portions';
import { planningOf } from '../plans/planning';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { viewAvailability } from './absences';
import { endUnavailable, reportUnavailable } from './unavailability';

// "I can't today" (ADR-0005 §2–§3, with its clarification): who may say it for whom
// (ADR-0018 §4), what the household sees of it (§3), and how it shrinks a fair portion
// (ADR-0002 §1), on a real database (TEST-11) with a clock the tests set (TEST-2).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

/**
 * Adds a member to `household`: a profile, linked to a new account when `withAccount`. Returns
 * its id and, with an account, the context it acts in.
 */
const add = async (household: PlannedHousehold, name: string, role: Role, withAccount: boolean) => {
  const [account] = withAccount
    ? await db
        .insert(accounts)
        .values({ name, email: `${name}-${String(++next)}@example.org`, culture: 'en-BE' })
        .returning({ id: accounts.id })
    : [];
  const [row] = await household.inIt((tx) =>
    tx
      .insert(members)
      .values({
        householdId: household.householdId,
        name,
        role,
        accountId: account?.id ?? null,
        birthDate: role === 'child' ? '2014-05-01' : null,
      })
      .returning({ id: members.id }),
  );
  if (!row) throw new Error('No member');
  if (!account) return { id: row.id, context: null };
  const member = await membership({ db }, account.id, household.householdId);
  if (!member) throw new Error('Not a member');
  const context: HouseholdContext = { ...household.head, member };
  return { id: row.id, context };
};

/** A member's context, which the test knows they have. */
const signedIn = ({ context }: { context: HouseholdContext | null }) => {
  if (!context) throw new Error('A profile without an account');
  return context;
};

/** What is stored, as whose, and from and to when in UTC. */
const stored = (household: PlannedHousehold) =>
  household.inIt((tx) =>
    tx
      .select({
        member: unavailabilities.memberId,
        startsAt: unavailabilities.startsAt,
        endsAt: unavailabilities.endsAt,
      })
      .from(unavailabilities),
  );

/** Until which day each member can't, as `context` sees it. */
const seen = async (context: HouseholdContext) => {
  const view = await viewAvailability(context);
  if (!view.ok) throw new Error(view.error);
  return Object.fromEntries(
    view.members.map((m) => [m.name, m.unavailableUntil?.toString() ?? null]),
  );
};

// The household's clock reads Thursday 8 October 2026, 10:00 in Brussels; weeks start on Mondays.

describe('reportUnavailable (ADR-0005 §3)', () => {
  it('lasts from now to the end of today by default, which everyone sees as its day', async () => {
    const household = await plannedHousehold(db);
    const result = await reportUnavailable(household.adult, {
      member: household.alex,
      lastDay: '2026-10-08',
    });
    expect(result).toEqual({ ok: true });
    expect(await stored(household)).toEqual([
      {
        member: household.alex,
        startsAt: new Date('2026-10-08T08:00:00Z'),
        endsAt: new Date('2026-10-08T22:00:00Z'),
      },
    ]);
    // Its days only, never when it was said (ADR-0018 §3).
    expect(await seen(household.head)).toEqual({ Robin: null, Alex: '2026-10-08' });
  });

  it('can last to a later day of this plan week, never past it or before today', async () => {
    const household = await plannedHousehold(db);
    const view = await viewAvailability(household.adult);
    expect(view.ok && view.unavailableDays.map(String)).toEqual([
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    const report = (lastDay: unknown) =>
      reportUnavailable(household.adult, { member: household.alex, lastDay });
    for (const lastDay of ['2026-10-07', '2026-10-12', '2026-02-30', 'tomorrow', undefined]) {
      expect(await report(lastDay)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await stored(household)).toEqual([]);
    expect(await report('2026-10-11')).toEqual({ ok: true });
    expect(await seen(household.adult)).toMatchObject({ Alex: '2026-10-11' });
  });

  it('moves its end when said again while it lasts', async () => {
    const household = await plannedHousehold(db);
    const report = (lastDay: string) =>
      reportUnavailable(household.adult, { member: household.alex, lastDay });
    await report('2026-10-10');
    household.clock.advance({ hours: 2 });
    await report('2026-10-08');
    expect(await stored(household)).toEqual([
      {
        member: household.alex,
        startsAt: new Date('2026-10-08T08:00:00Z'),
        endsAt: new Date('2026-10-08T22:00:00Z'),
      },
    ]);
  });

  it('lets a head say it for children and profiles without an account, never other adults (ADR-0018 §4)', async () => {
    const household = await plannedHousehold(db);
    const kim = await add(household, 'Kim', 'child', true);
    const noa = await add(household, 'Noa', 'child', false);
    const sam = await add(household, 'Sam', 'adult', false);
    const jo = await add(household, 'Jo', 'head', true);
    const report = (context: HouseholdContext, member: string) =>
      reportUnavailable(context, { member, lastDay: '2026-10-08' });
    for (const member of [household.robin, kim.id, noa.id, sam.id]) {
      expect(await report(household.head, member)).toEqual({ ok: true });
    }
    for (const member of [household.alex, jo.id]) {
      expect(await report(household.head, member)).toEqual({ ok: false, error: 'not-allowed' });
    }
    // A child with an account says it for themselves, an adult for nobody else.
    expect(await report(signedIn(kim), kim.id)).toEqual({ ok: true });
    for (const member of [household.robin, kim.id, noa.id, sam.id]) {
      expect(await report(household.adult, member)).toEqual({ ok: false, error: 'not-allowed' });
    }
    expect((await stored(household)).map((row) => row.member).sort()).toEqual(
      [household.robin, kim.id, noa.id, sam.id].sort(),
    );
  });

  it('finds no member of another household, and writes nothing there (TEST-4)', async () => {
    const ash = await plannedHousehold(db);
    const birch = await plannedHousehold(db);
    const noa = await add(ash, 'Noa', 'child', false);
    for (const member of [noa.id, ash.robin, 'Noa']) {
      expect(await reportUnavailable(birch.head, { member, lastDay: '2026-10-08' })).toEqual({
        ok: false,
        error: 'not-found',
      });
    }
    expect(await stored(ash)).toEqual([]);
    expect(await stored(birch)).toEqual([]);
  });

  it('logs a head acting for a profile without an account, never until when (ADR-0018 §5)', async () => {
    const household = await plannedHousehold(db);
    const noa = await add(household, 'Noa', 'child', false);
    const kim = await add(household, 'Kim', 'child', true);
    for (const member of [noa.id, kim.id, household.robin]) {
      await reportUnavailable(household.head, { member, lastDay: '2026-10-09' });
    }
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-09' });
    household.clock.advance({ hours: 1 });
    await endUnavailable(household.head, { member: noa.id });
    const shown = await householdActivity(household.adult);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.entries.map(({ actor, action, subject }) => [actor, action, subject])).toEqual([
      ['Robin', 'unavailable.ended', 'Noa'],
      ['Robin', 'unavailable.reported', 'Noa'],
    ]);
  });
});

describe('endUnavailable (ADR-0005 §3, clarification)', () => {
  it('ends it now, so it counts up to now only', async () => {
    const household = await plannedHousehold(db);
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-10' });
    household.clock.advance({ hours: 3 });
    expect(await endUnavailable(household.adult, { member: household.alex })).toEqual({
      ok: true,
    });
    expect(await stored(household)).toEqual([
      {
        member: household.alex,
        startsAt: new Date('2026-10-08T08:00:00Z'),
        endsAt: new Date('2026-10-08T11:00:00Z'),
      },
    ]);
    expect(await seen(household.head)).toEqual({ Robin: null, Alex: null });
    // Ended already: there is nothing left to end.
    expect(await endUnavailable(household.adult, { member: household.alex })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('removes one ended the moment it was said, which would end before it starts', async () => {
    const household = await plannedHousehold(db);
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-08' });
    expect(await endUnavailable(household.adult, { member: household.alex })).toEqual({
      ok: true,
    });
    expect(await stored(household)).toEqual([]);
  });

  it('is for whoever may say it, as reporting is (ADR-0018 §4)', async () => {
    const household = await plannedHousehold(db);
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-08' });
    expect(await endUnavailable(household.head, { member: household.alex })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    const birch = await plannedHousehold(db);
    expect(await endUnavailable(birch.head, { member: household.alex })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await stored(household)).toHaveLength(1);
  });
});

describe('fair portions with "I can\'t today" (ADR-0001 §6, ADR-0002 §1)', () => {
  it('shrink by the time a member couldn’t, as it ended up', async () => {
    const household = await plannedHousehold(db);
    // On Monday 12 October at 00:00, Alex can't for the whole day, then ends it at noon.
    household.clock.advance({ hours: 3 * 24 + 14 });
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-12' });
    household.clock.advance({ hours: 12 });
    await endUnavailable(household.adult, { member: household.alex });
    const portions = await household.inIt(async (tx) => {
      const { calendar } = await planningOf(tx);
      const week = {
        start: Temporal.PlainDate.from('2026-10-12'),
        end: Temporal.PlainDate.from('2026-10-19'),
      };
      return fairPortions(tx, calendar, week, []);
    });
    const alex = 1 - 12 / 168;
    expect(Object.fromEntries(portions.map((p) => [p.id, p.fairFraction]))).toEqual({
      [household.robin]: 1 / (1 + alex),
      [household.alex]: alex / (1 + alex),
    });
  });

  it('leave other weeks as they are', async () => {
    const household = await plannedHousehold(db);
    await reportUnavailable(household.adult, { member: household.alex, lastDay: '2026-10-11' });
    const portions = await household.inIt(async (tx) => {
      const { calendar } = await planningOf(tx);
      const week = {
        start: Temporal.PlainDate.from('2026-10-12'),
        end: Temporal.PlainDate.from('2026-10-19'),
      };
      return fairPortions(tx, calendar, week, []);
    });
    expect(portions.map((p) => p.fairFraction)).toEqual([0.5, 0.5]);
  });
});
