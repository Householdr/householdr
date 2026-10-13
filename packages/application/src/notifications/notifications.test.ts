import { members, notifications, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousehold } from '../households/start-household';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { deleteExpiredNotifications } from './expired';
import { householdNotifications } from './household-notifications';

// Notifications are written with the change that causes them, for whom the catalogue says
// (ADR-0014 §2, §7, clarifications), and deleted after 90 days, on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026.
const week = '2026-10-12';

/** Robin, a head, and Alex, an adult, with the dishes to do every day. */
const household = async (options?: Parameters<typeof plannedHousehold>[1]) => {
  const h = await plannedHousehold(db, options);
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  return h;
};

/** The household's notifications, oldest first, by whom they are for. */
const kept = (h: PlannedHousehold) =>
  h.inIt(async (tx) => {
    const rows = await tx
      .select({
        to: members.name,
        kind: notifications.kind,
        at: notifications.at,
        week: notifications.week,
      })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.memberId))
      .orderBy(asc(notifications.at), asc(members.name));
    return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
  });

const makeHead = (h: PlannedHousehold, memberId: string) =>
  h.inIt((tx) => tx.update(members).set({ role: 'head' }).where(eq(members.id, memberId)));

const now = '2026-10-08T08:00:00.000Z';

describe('a draft ready for review (ADR-0014 §2, ADR-0006 §5)', () => {
  it('is for the heads, when the scheduler first drafts the week', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    expect(await kept(h)).toEqual([{ to: 'Robin', kind: 'plan.drafted', at: now, week }]);
  });

  it('is not sent again when a head drafts the week again (clarification)', async () => {
    const h = await household();
    await makeHead(h, h.alex);
    await draftPlan(h.scheduler, { week });
    h.clock.advance({ minutes: 10 });
    await draftPlan(h.head, { week });
    expect((await kept(h)).map((n) => n.to)).toEqual(['Alex', 'Robin']);
  });

  it('is for the other heads only, when a head made it (clarification)', async () => {
    const h = await household();
    await makeHead(h, h.alex);
    await draftPlan(h.head, { week });
    expect((await kept(h)).map((n) => n.to)).toEqual(['Alex']);
  });

  it('is for the other heads only, when a head starts the household now (ADR-0007 §3)', async () => {
    const lone = await household({ started: null });
    expect(await startHousehold(lone.head, { when: 'now' })).toMatchObject({ drafted: true });
    expect(await kept(lone)).toEqual([]);

    const h = await household({ started: null });
    await makeHead(h, h.alex);
    await startHousehold(h.head, { when: 'now' });
    expect(await kept(h)).toEqual([
      { to: 'Alex', kind: 'plan.drafted', at: now, week: '2026-10-05' },
    ]);
  });

  it('goes with the draft of a week the household turns out to be away for (ADR-0005 §5)', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    await h.away('2026-10-12', '2026-10-18');
    expect(await draftPlan(h.head, { week })).toEqual({ ok: true, planned: false });
    expect(await kept(h)).toEqual([]);
  });
});

describe('a published plan (ADR-0014 §2, ADR-0006 §5)', () => {
  it('is for each member with an occurrence in it', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    h.clock.advance({ hours: 1 });
    expect(await publishPlan(h.scheduler, { week })).toEqual({ ok: true });
    expect((await kept(h)).filter((n) => n.kind === 'plan.published')).toEqual([
      { to: 'Alex', kind: 'plan.published', at: '2026-10-08T09:00:00.000Z', week },
      { to: 'Robin', kind: 'plan.published', at: '2026-10-08T09:00:00.000Z', week },
    ]);
  });

  it('is not for a member with nothing in it, nor for a profile without an account', async () => {
    const h = await household();
    await h.share(h.alex, 0);
    await h.inIt((tx) =>
      tx.insert(members).values({ householdId: h.householdId, name: 'Jo', role: 'adult' }),
    );
    await draftPlan(h.scheduler, { week });
    await publishPlan(h.scheduler, { week });
    const published = (await kept(h)).filter((n) => n.kind === 'plan.published');
    expect(published.map((n) => n.to)).toEqual(['Robin']);
  });

  it('is not for the head who publishes it early (clarification), nor sent twice', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    const plan = await h.plan(week);
    expect(await publishPlan(h.head, { week, version: plan?.version })).toEqual({ ok: true });
    expect(await publishPlan(h.scheduler, { week })).toEqual({ ok: true });
    const published = (await kept(h)).filter((n) => n.kind === 'plan.published');
    expect(published.map((n) => n.to)).toEqual(['Alex']);
  });

  it('is not written when nothing is published', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    const plan = await h.plan(week);
    await draftPlan(h.head, { week });
    expect(await publishPlan(h.head, { week, version: plan?.version })).toEqual({
      ok: false,
      error: 'conflict',
    });
    expect((await kept(h)).map((n) => n.kind)).toEqual(['plan.drafted']);
  });
});

describe('deleteExpiredNotifications (ADR-0014 §7, ADR-0012 §5)', () => {
  it('deletes those older than 90 days, in every household, and keeps the rest', async () => {
    const [h, other] = [await household(), await household()];
    await draftPlan(h.scheduler, { week });
    await draftPlan(other.scheduler, { week });
    h.clock.advance({ hours: 24 });
    await publishPlan(h.scheduler, { week });
    const at = (days: number) => ({
      db,
      clock: { now: () => Temporal.Instant.from(now).add({ hours: days * 24 }) },
    });

    await deleteExpiredNotifications(at(90));
    expect(await kept(h)).toHaveLength(3);
    await deleteExpiredNotifications(at(90.5));
    expect((await kept(h)).map((n) => n.kind)).toEqual(['plan.published', 'plan.published']);
    expect(await kept(other)).toEqual([]);
    await deleteExpiredNotifications(at(91.5));
    expect(await kept(h)).toEqual([]);
  });
});

describe('householdNotifications (ADR-0014 §7, clarification)', () => {
  it('lists the member’s own, newest first, with the day they came and the plan’s week', async () => {
    const h = await household();
    await draftPlan(h.scheduler, { week });
    // Published on Sunday, and read on Monday.
    h.clock.advance({ hours: 72 });
    await publishPlan(h.scheduler, { week });
    h.clock.advance({ hours: 24 });
    const days = {
      first: Temporal.PlainDate.from(week),
      last: Temporal.PlainDate.from('2026-10-18'),
    };
    expect(await householdNotifications(h.head)).toEqual({
      ok: true,
      household: 'Ash Lane',
      notifications: [
        {
          id: expect.any(String) as string,
          kind: 'plan.published',
          day: Temporal.PlainDate.from('2026-10-11'),
          when: 'yesterday',
          week: days,
        },
        {
          id: expect.any(String) as string,
          kind: 'plan.drafted',
          day: Temporal.PlainDate.from('2026-10-08'),
          when: 'some-days-ago',
          week: days,
        },
      ],
    });
    // Alex, no head, hears of the published plan only.
    expect(await householdNotifications(h.adult)).toMatchObject({
      ok: true,
      notifications: [{ kind: 'plan.published', when: 'yesterday', week: days }],
    });
  });

  it('says the day in the household’s time zone', async () => {
    const h = await household({ timeZone: 'Europe/Helsinki', country: 'FI' });
    // At 22:00 UTC on Thursday 8 October, it is Friday the 9th in Helsinki.
    h.clock.advance({ hours: 14 });
    await draftPlan(h.scheduler, { week });
    expect(await householdNotifications(h.head)).toMatchObject({
      notifications: [{ day: Temporal.PlainDate.from('2026-10-09'), when: 'today' }],
    });
  });

  it('gives nobody else’s, nor any from another household (TEST-4)', async () => {
    const [h, other] = [await household(), await household()];
    await draftPlan(h.scheduler, { week });
    await draftPlan(other.scheduler, { week });
    expect(await householdNotifications(h.adult)).toEqual({
      ok: true,
      household: 'Ash Lane',
      notifications: [],
    });
    expect(
      await householdNotifications({ ...h.head, householdId: other.householdId }),
    ).toMatchObject({ ok: true, notifications: [] });
  });

  it('is for members with an account only, who are the ones told (ADR-0017 §2)', async () => {
    const h = await household();
    const profile = { ...h.adult.member, hasAccount: false };
    expect(await householdNotifications({ ...h.adult, member: profile })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });
});
