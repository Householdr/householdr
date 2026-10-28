import { activityLog, assignments, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { draftPlan } from './draft-plan';
import { publishPlan } from './publish-plan';
import { answerSwap, proposeSwap } from './swaps';
import { plannedHousehold, type PlannedHousehold } from './testing';
import { viewPlan } from './view-plan';

// Swaps between members (ADR-0002 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026.
const week = '2026-10-12';

/**
 * A household with three chores any day of the week, its plan for `week` published and under
 * way: the clock reads Wednesday 14 October.
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

/** The assignments of `week` by member name, with their ids, tasks and reasons. */
const assigned = async (h: PlannedHousehold) => {
  const rows = await h.inIt((tx) =>
    tx
      .select({ id: assignments.id, member: assignments.memberId, reason: assignments.reason })
      .from(assignments),
  );
  const of = (member: string) => rows.filter((row) => row.member === member);
  return { robin: of(h.robin), alex: of(h.alex) };
};

describe('swaps (ADR-0002 §5)', () => {
  it('hands an occurrence off once the other accepts, showing both balances first', async () => {
    const h = await published();
    const { alex } = await assigned(h);
    const [give] = alex;
    if (!give) throw new Error('Alex has nothing');
    const proposed = await proposeSwap(h.adult, { from: h.alex, give: give.id, to: h.robin });
    if (!proposed.ok) throw new Error(proposed.error);
    const view = await viewPlan(h.head);
    if (!view.ok) throw new Error('Not viewed');
    const [swap] = view.swaps;
    expect(swap).toMatchObject({ mayAnswer: true, take: null, from: { id: h.alex } });
    // Alex goes behind by what it costs them, Robin ahead by what it costs Robin.
    expect((swap?.balances.from.after ?? 0) - (swap?.balances.from.now ?? 0)).toBeLessThan(0);
    expect((swap?.balances.to.after ?? 0) - (swap?.balances.to.now ?? 0)).toBeGreaterThan(0);
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: true })).toEqual({ ok: true });
    const after = await assigned(h);
    expect(after.robin).toContainEqual({ id: give.id, member: h.robin, reason: 'swapped' });
    // Answered once: a second answer finds nothing waiting.
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: true })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('trades one occurrence for another, or changes nothing when declined', async () => {
    const h = await published();
    const { robin, alex } = await assigned(h);
    const [give] = alex;
    const [take] = robin;
    if (!give || !take) throw new Error('Not both have one');
    const declined = await proposeSwap(h.adult, {
      from: h.alex,
      give: give.id,
      to: h.robin,
      take: take.id,
    });
    if (!declined.ok) throw new Error(declined.error);
    // Offered once at a time.
    expect(await proposeSwap(h.adult, { from: h.alex, give: give.id, to: h.robin })).toEqual({
      ok: false,
      error: 'already-proposed',
    });
    expect(await answerSwap(h.head, { swap: declined.swapId, accept: false })).toEqual({
      ok: true,
    });
    expect(await assigned(h)).toEqual({ robin, alex });
    const traded = await proposeSwap(h.adult, {
      from: h.alex,
      give: give.id,
      to: h.robin,
      take: take.id,
    });
    if (!traded.ok) throw new Error(traded.error);
    await answerSwap(h.head, { swap: traded.swapId, accept: true });
    const after = await assigned(h);
    expect(after.robin.map((a) => a.id)).toContain(give.id);
    expect(after.alex.map((a) => a.id)).toContain(take.id);
  });

  it('voids a swap whose occurrence was done in the meantime', async () => {
    const h = await published();
    const [give] = (await assigned(h)).alex;
    if (!give) throw new Error('Alex has nothing');
    const proposed = await proposeSwap(h.adult, { from: h.alex, give: give.id, to: h.robin });
    if (!proposed.ok) throw new Error(proposed.error);
    const [row] = await h.inIt((tx) =>
      tx
        .select({ occurrence: assignments.occurrenceId })
        .from(assignments)
        .where(eq(assignments.id, give.id)),
    );
    await completeOccurrence(h.adult, { occurrence: row?.occurrence });
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: true })).toEqual({
      ok: false,
      error: 'gone',
    });
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: false })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('is for the members themselves, or a head for a profile, which is logged (ADR-0018 §5)', async () => {
    const h = await published();
    const { robin, alex } = await assigned(h);
    const [give] = alex;
    const [own] = robin;
    if (!give || !own) throw new Error('Not both have one');
    // A head doesn't offer another adult's occurrence, nor answer for them.
    expect(await proposeSwap(h.head, { from: h.alex, give: give.id, to: h.robin })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    const proposed = await proposeSwap(h.head, { from: h.robin, give: own.id, to: h.alex });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: true })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    // Once Alex is a profile without an account, a head acts for them, and it is logged.
    await h.inIt((tx) => tx.update(members).set({ accountId: null }).where(eq(members.id, h.alex)));
    expect(await answerSwap(h.head, { swap: proposed.swapId, accept: true })).toEqual({ ok: true });
    const logged = await h.inIt((tx) =>
      tx.select({ action: activityLog.action, subject: activityLog.subjectId }).from(activityLog),
    );
    expect(logged).toEqual([{ action: 'swap.answered', subject: h.alex }]);
  });

  it('refuses what isn’t theirs, or another household’s (TEST-4)', async () => {
    const h = await published();
    const elsewhere = await published();
    const [theirs] = (await assigned(elsewhere)).alex;
    const [own] = (await assigned(h)).robin;
    if (!theirs || !own) throw new Error('Nothing to swap');
    expect(await proposeSwap(h.adult, { from: h.alex, give: theirs.id, to: h.robin })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await proposeSwap(h.adult, { from: h.alex, give: own.id, to: h.robin })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await proposeSwap(h.adult, { from: h.alex, give: own.id, to: h.alex })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('offers nothing to a former member (ADR-0005 §4)', async () => {
    const h = await published();
    const [own] = (await assigned(h)).robin;
    if (!own) throw new Error('Robin has nothing');
    await h.inIt((tx) =>
      tx
        .update(members)
        .set({ leftAt: new Date(), accountId: null, sharePercent: null })
        .where(eq(members.id, h.alex)),
    );
    expect(await proposeSwap(h.head, { from: h.robin, give: own.id, to: h.alex })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });
});
