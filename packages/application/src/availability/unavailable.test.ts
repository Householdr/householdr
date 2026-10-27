import { activityLog, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { viewAvailability } from './absences';
import { endUnavailable, reportUnavailable } from './unavailable';

// "I can't today" (ADR-0005 §3), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026.
const week = '2026-10-12';

/**
 * A household with chores any day of the week, its plan for `week` published, and the clock on
 * Wednesday 14 October, 10:00 in Brussels.
 */
const published = async () => {
  const h = await plannedHousehold(db);
  await h.task('Vacuum', 30, 'weekly', '2026-10-14');
  await h.task('Bathroom', 45, 'weekly', '2026-10-16');
  await h.task('Laundry', 60, 'weekly', '2026-10-13');
  await draftPlan(h.scheduler, { week });
  await publishPlan(h.scheduler, { week });
  h.clock.advance({ hours: 6 * 24 });
  return h;
};

/** Who has each task in the plan of `week`, and why. */
const plan = async (h: PlannedHousehold) =>
  ((await h.plan(week))?.rows ?? []).map(({ task, member, reason }) => ({ task, member, reason }));

describe('reportUnavailable (ADR-0005 §3)', () => {
  it('re-allocates what the member can no longer do this week to the others', async () => {
    const h = await published();
    expect(await reportUnavailable(h.adult, { member: h.alex, lastDay: '2026-10-18' })).toEqual({
      ok: true,
    });
    const rows = await plan(h);
    // Every task can be done any day this week, which Alex now can't on any day left.
    expect(rows.every((row) => row.member === 'Robin')).toBe(true);
    expect(rows.some((row) => row.reason === 're-allocated: member unavailable')).toBe(true);
  });

  it('leaves what the member can still do later in the week', async () => {
    const h = await published();
    const before = await plan(h);
    expect(await reportUnavailable(h.adult, { member: h.alex, lastDay: '2026-10-14' })).toEqual({
      ok: true,
    });
    expect(await plan(h)).toEqual(before);
  });

  it('moves its end when reported again, and "I can after all" ends it', async () => {
    const h = await published();
    await reportUnavailable(h.adult, { member: h.alex, lastDay: '2026-10-14' });
    const view = async () => {
      const result = await viewAvailability(h.head);
      if (!result.ok) throw new Error('Not viewed');
      return result.members.find((m) => m.id === h.alex)?.unavailableUntil?.toString() ?? null;
    };
    expect(await view()).toBe('2026-10-14');
    await reportUnavailable(h.adult, { member: h.alex, lastDay: '2026-10-16' });
    expect(await view()).toBe('2026-10-16');
    h.clock.advance({ hours: 1 });
    expect(await endUnavailable(h.adult, { member: h.alex })).toEqual({ ok: true });
    expect(await view()).toBeNull();
    // Ending it twice changes nothing (CODE-19).
    expect(await endUnavailable(h.adult, { member: h.alex })).toEqual({ ok: true });
  });

  it('lasts until today or a later day of this plan week only', async () => {
    const h = await published();
    for (const lastDay of ['2026-10-13', '2026-10-19', '2026-02-30', 'tomorrow']) {
      expect(await reportUnavailable(h.adult, { member: h.alex, lastDay })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
  });

  it('is for the member, or a head for a profile without an account, which is logged (ADR-0018 §4–§5)', async () => {
    const h = await published();
    // A head never reports another adult with an account.
    expect(await reportUnavailable(h.head, { member: h.alex, lastDay: '2026-10-14' })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    await h.inIt((tx) => tx.update(members).set({ accountId: null }).where(eq(members.id, h.alex)));
    expect(await reportUnavailable(h.head, { member: h.alex, lastDay: '2026-10-14' })).toEqual({
      ok: true,
    });
    expect(await endUnavailable(h.head, { member: h.alex })).toEqual({ ok: true });
    const logged = await h.inIt((tx) =>
      tx.select({ action: activityLog.action, subject: activityLog.subjectId }).from(activityLog),
    );
    expect(logged).toEqual([
      { action: 'unavailable.reported', subject: h.alex },
      { action: 'unavailable.ended', subject: h.alex },
    ]);
  });

  it('finds no member of another household (TEST-4)', async () => {
    const h = await published();
    const elsewhere = await published();
    expect(
      await reportUnavailable(h.head, { member: elsewhere.alex, lastDay: '2026-10-14' }),
    ).toEqual({ ok: false, error: 'not-found' });
  });
});
