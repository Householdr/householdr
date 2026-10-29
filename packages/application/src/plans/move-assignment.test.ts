import { activityLog, members, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOccurrence } from '../completions/complete-occurrence';
import { draftPlan } from './draft-plan';
import { moveAssignment } from './move-assignment';
import { publishPlan } from './publish-plan';
import { plannedHousehold, type PlannedHousehold } from './testing';

// Heads moving an occurrence in a draft or after publishing (ADR-0006 §2–§3), on a real database
// (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

// The week of Monday 12 October 2026.
const week = '2026-10-12';

/** A household with a weekly vacuuming on Wednesday, drafted for `week`. */
const drafted = async () => {
  const h = await plannedHousehold(db);
  await h.task('Vacuum', 30, 'weekly', '2026-10-14');
  const result = await draftPlan(h.scheduler, { week });
  if (!result.ok) throw new Error('Not drafted');
  return h;
};

/** The vacuuming's assignment in the plan of `week`, as stored, with its id. */
const vacuuming = async (h: PlannedHousehold) => {
  const ids = await h.inIt((tx) => tx.query.assignments.findMany());
  const plan = await h.plan(week);
  const row = plan?.rows.find((r) => r.task === 'Vacuum');
  const stored = ids.find((a) => a.occurrenceId === row?.occurrence);
  if (!plan || !row || !stored) throw new Error('No vacuuming');
  return { ...row, id: stored.id, plan };
};

/** The other member than whoever has the vacuuming. */
const other = (h: PlannedHousehold, member: string | null) =>
  member === 'Robin' ? h.alex : h.robin;

const entries = (h: PlannedHousehold) =>
  h.inIt((tx) =>
    tx
      .select({
        action: activityLog.action,
        actor: activityLog.actorId,
        subject: activityLog.subjectId,
        task: activityLog.taskName,
      })
      .from(activityLog),
  );

describe('moveAssignment (ADR-0006 §2–§3)', () => {
  it('moves an occurrence of a draft as a pre-assignment, which drafting again keeps', async () => {
    const h = await drafted();
    const before = await vacuuming(h);
    const to = other(h, before.member);
    expect(
      await moveAssignment(h.head, { assignment: before.id, version: before.version, member: to }),
    ).toEqual({ ok: true });
    const after = await vacuuming(h);
    expect(after).toMatchObject({ reason: 'assigned by head', cost: 30 });
    expect(after.member).not.toBe(before.member);
    // The draft moves on, so a head publishes it as it is now (ADR-0019 §5).
    expect(after.plan.version).toBe(before.plan.version + 1);
    expect(await draftPlan(h.head, { week })).toMatchObject({ ok: true });
    expect(await vacuuming(h)).toMatchObject({ member: after.member, reason: 'assigned by head' });
    // A draft is for heads' eyes only, so nothing is logged (ADR-0006 §2, clarification).
    expect(await entries(h)).toEqual([]);
  });

  it('reassigns an open occurrence after publishing, and logs it (ADR-0018 §5)', async () => {
    const h = await drafted();
    await publishPlan(h.scheduler, { week });
    h.clock.advance({ hours: 4 * 24 });
    const before = await vacuuming(h);
    const fromAlex = before.member === 'Alex';
    const to = other(h, before.member);
    expect(
      await moveAssignment(h.head, { assignment: before.id, version: before.version, member: to }),
    ).toEqual({ ok: true });
    expect(await vacuuming(h)).toMatchObject({ reason: 'assigned by head' });
    // Whom it was taken from and given to, never the head as done to themselves.
    expect(await entries(h)).toEqual(
      fromAlex
        ? [{ action: 'assignment.taken', actor: h.robin, subject: h.alex, task: 'Vacuum' }]
        : [{ action: 'assignment.given', actor: h.robin, subject: h.alex, task: 'Vacuum' }],
    );
  });

  it('changes nothing when moved to whoever has it (CODE-19)', async () => {
    const h = await drafted();
    const before = await vacuuming(h);
    const to = before.member === 'Robin' ? h.robin : h.alex;
    expect(
      await moveAssignment(h.head, { assignment: before.id, version: before.version, member: to }),
    ).toEqual({ ok: true });
    expect(await vacuuming(h)).toEqual(before);
  });

  it('refuses a version moved on since (ADR-0019 §5)', async () => {
    const h = await drafted();
    const before = await vacuuming(h);
    const to = other(h, before.member);
    await moveAssignment(h.head, { assignment: before.id, version: before.version, member: to });
    expect(
      await moveAssignment(h.head, {
        assignment: before.id,
        version: before.version,
        member: other(h, (await vacuuming(h)).member),
      }),
    ).toEqual({ ok: false, error: 'conflict' });
  });

  it('leaves an occurrence that is done, or whose week is over', async () => {
    const h = await drafted();
    await publishPlan(h.scheduler, { week });
    h.clock.advance({ hours: 6 * 24 });
    const before = await vacuuming(h);
    const doer = before.member === 'Robin' ? h.head : h.adult;
    await completeOccurrence(doer, { occurrence: before.occurrence });
    const done = await vacuuming(h);
    expect(
      await moveAssignment(h.head, {
        assignment: done.id,
        version: done.version,
        member: other(h, done.member),
      }),
    ).toEqual({ ok: false, error: 'not-movable' });

    const late = await drafted();
    await publishPlan(late.scheduler, { week });
    late.clock.advance({ hours: 12 * 24 });
    const open = await vacuuming(late);
    expect(
      await moveAssignment(late.head, {
        assignment: open.id,
        version: open.version,
        member: other(late, open.member),
      }),
    ).toEqual({ ok: false, error: 'not-movable' });
  });

  it('is for heads with two factors only (TEST-4)', async () => {
    const h = await drafted();
    const before = await vacuuming(h);
    const input = { assignment: before.id, version: before.version, member: h.alex };
    for (const member of [h.adult.member, { ...h.head.member, twoFactor: false }]) {
      expect(await moveAssignment({ ...h.head, member }, input)).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await vacuuming(h)).toEqual(before);
  });

  it('finds no assignment or member of another household (TEST-4)', async () => {
    const h = await drafted();
    const elsewhere = await drafted();
    const theirs = await vacuuming(elsewhere);
    const ours = await vacuuming(h);
    expect(
      await moveAssignment(h.head, { assignment: theirs.id, version: 1, member: h.alex }),
    ).toEqual({ ok: false, error: 'not-found' });
    expect(
      await moveAssignment(h.head, {
        assignment: ours.id,
        version: ours.version,
        member: elsewhere.alex,
      }),
    ).toEqual({ ok: false, error: 'not-found' });
    expect(
      await moveAssignment(h.head, { assignment: 'nope', version: 1, member: h.alex }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('moves nothing to a former member (ADR-0005 §4)', async () => {
    const h = await drafted();
    const before = await vacuuming(h);
    await h.inIt((tx) =>
      tx
        .update(members)
        .set({ leftAt: new Date(), accountId: null, sharePercent: null })
        .where(eq(members.id, h.alex)),
    );
    expect(
      await moveAssignment(h.head, {
        assignment: before.id,
        version: before.version,
        member: h.alex,
      }),
    ).toEqual({ ok: false, error: 'not-found' });
  });
});
