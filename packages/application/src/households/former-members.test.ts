import { activityLog, assignments, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addAbsence, viewAvailability } from '../availability/absences';
import { reportUnavailable } from '../availability/unavailability';
import { completeOccurrence } from '../completions/complete-occurrence';
import { householdBalances } from '../ledger/balances';
import { draftPlan } from '../plans/draft-plan';
import { fairPortions } from '../plans/fair-portions';
import { planningOf } from '../plans/planning';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { viewPlan } from '../plans/view-plan';
import { addTemporaryShare } from '../shares/temporary-shares';
import { changeShare, householdShares } from '../shares/shares';
import { householdActivity } from './activity';
import { invite } from './invitations';
import { viewHousehold } from './membership';

// Former members (ADR-0005 §4, clarifications): their record stays for the household's history,
// but they have no place in it any more, and show as "Former member" (ADR-0012 §6). On a real
// database (TEST-11); nobody leaves yet, so the tests make a member a former one directly.

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The household's clock reads Thursday 8 October 2026, 10:00 in Brussels; weeks start on Mondays.

/** Sam, a profile without an account who left at `leftAt`; Robin and Alex stay. */
async function withFormer(leftAt = new Date('2026-10-01T10:00:00Z'), started?: string) {
  const h = await plannedHousehold(db, started ? { started, startedNow: true } : {});
  const [sam] = await h.inIt((tx) =>
    tx
      .insert(members)
      .values({
        householdId: h.householdId,
        name: 'Sam',
        role: 'adult',
        joinedAt: new Date('2026-09-01T00:00:00Z'),
        leftAt,
      })
      .returning({ id: members.id }),
  );
  if (!sam) throw new Error('No Sam');
  return { ...h, sam: sam.id };
}

/** Makes Alex a former member at `leftAt`, as leaving will: without their account. */
const alexLeaves = (h: PlannedHousehold, leftAt: Date) =>
  h.inIt((tx) => tx.update(members).set({ leftAt, accountId: null }).where(eq(members.id, h.alex)));

describe('former members', () => {
  it('aren’t on the household’s page, its days away, its shares or its balances', async () => {
    const h = await withFormer();
    const household = await viewHousehold(h.head);
    expect(household.ok && household.members.map((m) => m.name)).toEqual(['Robin', 'Alex']);
    const availability = await viewAvailability(h.head);
    expect(availability.ok && availability.members.map((m) => m.name)).toEqual(['Robin', 'Alex']);
    const shares = await householdShares(h.head);
    expect(shares.ok && shares.shares.map((s) => s.name)).toEqual(['Robin', 'Alex']);
    const balances = await householdBalances(h.head);
    expect(balances.ok && balances.members.map((m) => m.name)).toEqual(['Robin', 'Alex']);
  });

  it('can’t be invited, given days away, said to be unavailable or given a share', async () => {
    const h = await withFormer();
    expect(await invite(h.head, { member: h.sam })).toEqual({ ok: false, error: 'not-found' });
    expect(
      await addAbsence(h.head, { member: h.sam, firstDay: '2026-10-12', lastDay: '2026-10-13' }),
    ).toMatchObject({ ok: false, error: 'not-found' });
    expect(await reportUnavailable(h.head, { member: h.sam, lastDay: '2026-10-08' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await changeShare(h.head, { member: h.sam, percent: 50, version: 1 })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(
      await addTemporaryShare(h.head, {
        member: h.sam,
        firstDay: '2026-10-12',
        lastDay: '2026-10-13',
        percent: 50,
      }),
    ).toEqual({ ok: false, error: 'not-found' });
  });

  it('have no fair portion of a week after they left, and one up to then of the week they left', async () => {
    const h = await withFormer(new Date('2026-10-04T10:00:00Z'));
    const week = {
      start: Temporal.PlainDate.from('2026-10-05'),
      end: Temporal.PlainDate.from('2026-10-12'),
    };
    const portions = async () => {
      const { calendar } = await h.inIt((tx) => planningOf(tx));
      const list = await h.inIt((tx) => fairPortions(tx, calendar, week, []));
      return Object.fromEntries(list.map((p) => [p.id, p.fairFraction]));
    };
    expect(Object.keys(await portions()).sort()).toEqual([h.robin, h.alex].sort());
    // Alex leaves on Thursday at 10:00, three and a half days into the week of seven.
    await alexLeaves(h, new Date('2026-10-08T08:00:00Z'));
    const fractions = await portions();
    expect(fractions[h.alex]).toBeCloseTo(3.4166 / (7 + 3.4166), 3);
    expect(fractions[h.robin]).toBeCloseTo(7 / (7 + 3.4166), 3);
  });

  it('have no place in a plan, and show as a former member in what they did', async () => {
    const h = await plannedHousehold(db, { started: '2026-10-05', startedNow: true });
    await h.task('Dishes', 20, 'daily', '2026-10-08');
    const drafted = await draftPlan(h.head, { week: '2026-10-05' });
    if (!drafted.ok) throw new Error('Not drafted');
    // Robin has every task; Alex picks today's up.
    await h.inIt((tx) => tx.update(assignments).set({ memberId: h.robin }));
    const draft = await h.plan('2026-10-05');
    await publishPlan(h.head, { week: '2026-10-05', version: draft?.version });
    const [today, tomorrow] = draft?.rows ?? [];
    expect(
      await completeOccurrence(h.adult, { occurrence: today?.occurrence, doers: [h.alex] }),
    ).toMatchObject({ ok: true });
    await alexLeaves(h, new Date('2026-10-08T08:30:00Z'));
    const view = await viewPlan(h.head);
    if (!view.ok) throw new Error(view.error);
    const [robin, ...others] = view.thisWeek?.members ?? [];
    expect(robin?.name).toBe('Robin');
    expect(others).toEqual([]);
    const done = robin?.assignments.find((a) => a.occurrence === today?.occurrence);
    expect(done?.completion?.doers).toEqual([{ id: h.alex, name: null }]);
    expect(done?.completion?.loggedBy).toEqual({ id: h.alex, name: null });
    // Nobody can credit them any more.
    expect(
      await completeOccurrence(h.head, { occurrence: tomorrow?.occurrence, doers: [h.alex] }),
    ).toMatchObject({ ok: false });
  });

  it('show as a former member in the activity log', async () => {
    const h = await withFormer();
    await h.inIt((tx) =>
      tx.insert(activityLog).values({
        householdId: h.householdId,
        at: new Date('2026-09-30T10:00:00Z'),
        actorId: h.sam,
        action: 'share.changed',
        subjectId: h.sam,
      }),
    );
    const activity = await householdActivity(h.adult);
    expect(activity.ok && activity.entries.map((e) => [e.actor, e.subject])).toEqual([
      [null, null],
    ]);
  });
});
