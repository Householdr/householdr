import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inHousehold, type Database } from './connection';
import {
  activityLog,
  households,
  members,
  type ActivityAction,
  type SetBeforeStart,
} from './schema';
import { refusal, testDatabase } from './testing';
import { atVersion, nextVersion } from './versioned';

// The activity log keeps its entries as they were (ADR-0018 §5), and versioned updates never
// overwrite a change made since (ADR-0019 §5), on a real database as the app's role (TEST-11).

let db: Database;
let owner: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, owner, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

/** A household with Robin, its head, and one entry of the log, by Robin. */
const withEntry = async () => {
  const id = newId();
  return inHousehold(db, id, async (tx) => {
    await tx.insert(households).values({
      id,
      name: 'Ash Lane',
      country: 'BE',
      language: 'en',
      timeZone: 'Europe/Brussels',
      weekStartDay: 1,
    });
    const [robin] = await tx
      .insert(members)
      .values({ householdId: id, name: 'Robin', role: 'head' })
      .returning({ id: members.id });
    if (!robin) throw new Error('No member');
    const at = new Date('2026-10-08T08:00:00Z');
    await tx
      .insert(activityLog)
      .values({ householdId: id, at, actorId: robin.id, action: 'household.name' });
    return { id, robin: robin.id };
  });
};

describe('the activity log (ADR-0018 §5)', () => {
  it('takes and shows entries in their household', async () => {
    const { id, robin } = await withEntry();
    const entries = await inHousehold(db, id, (tx) => tx.select().from(activityLog));
    expect(entries).toEqual([
      {
        id: expect.any(String) as string,
        householdId: id,
        at: new Date('2026-10-08T08:00:00Z'),
        actorId: robin,
        action: 'household.name',
        setBeforeStart: null,
        subjectId: null,
      },
    ]);
  });

  it('can’t be changed or deleted by the app (`migrate.ts`)', async () => {
    const { id } = await withEntry();
    // PostgreSQL's code for a missing privilege.
    expect(
      await refusal(
        inHousehold(db, id, (tx) => tx.update(activityLog).set({ action: 'household.country' })),
      ),
    ).toBe('42501');
    expect(await refusal(inHousehold(db, id, (tx) => tx.delete(activityLog)))).toBe('42501');
  });

  it('keeps an entry whose actor’s profile goes, without them', async () => {
    const { id, robin } = await withEntry();
    // Profiles are deleted by a use case not built yet; the owner stands in for it here.
    await owner.delete(members).where(eq(members.id, robin));
    const entries = await inHousehold(db, id, (tx) => tx.select().from(activityLog));
    expect(entries).toMatchObject([{ actorId: null, action: 'household.name' }]);
  });

  it('takes only the actions it knows', async () => {
    const { id } = await withEntry();
    const unknown = inHousehold(db, id, (tx) =>
      tx.insert(activityLog).values({
        householdId: id,
        at: new Date(),
        action: 'household.colour' as 'household.name',
      }),
    );
    expect(await refusal(unknown)).toBe('activity_log_action');
  });

  it('names whom a completion entry was done to, and keeps it once their profile goes', async () => {
    const { id, robin } = await withEntry();
    const [alex] = await inHousehold(db, id, (tx) =>
      tx
        .insert(members)
        .values({ householdId: id, name: 'Alex', role: 'adult' })
        .returning({ id: members.id }),
    );
    if (!alex) throw new Error('No member');
    const entry = (action: ActivityAction) =>
      inHousehold(db, id, (tx) =>
        tx
          .insert(activityLog)
          .values({ householdId: id, at: new Date(), actorId: robin, action, subjectId: alex.id }),
      );
    expect(await refusal(entry('completion.logged'))).toBeUndefined();
    expect(await refusal(entry('completion.undone'))).toBeUndefined();
    // Only the actions done to someone name them (ADR-0018 §5).
    expect(await refusal(entry('household.name'))).toBe('activity_log_subject');
    await owner.delete(members).where(eq(members.id, alex.id));
    const entries = await inHousehold(db, id, (tx) =>
      tx
        .select({ action: activityLog.action, subjectId: activityLog.subjectId })
        .from(activityLog)
        .where(eq(activityLog.actorId, robin)),
    );
    expect(entries).toEqual(
      expect.arrayContaining([
        { action: 'completion.logged', subjectId: null },
        { action: 'completion.undone', subjectId: null },
      ]),
    );
  });

  it('lists what was set before the start in the start entry only, by member id (ADR-0007 §2)', async () => {
    const { id, robin } = await withEntry();
    const entry = (action: ActivityAction, setBeforeStart: unknown) =>
      inHousehold(db, id, (tx) =>
        tx.insert(activityLog).values({
          householdId: id,
          at: new Date(),
          actorId: robin,
          action,
          setBeforeStart: setBeforeStart as SetBeforeStart,
        }),
      );
    const broken = 'activity_log_set_before_start';
    expect(
      await refusal(entry('household.started', { shares: [robin], daysAway: [] })),
    ).toBeUndefined();
    expect(await refusal(entry('household.started', null))).toBe(broken);
    expect(await refusal(entry('household.name', { shares: [], daysAway: [] }))).toBe(broken);
    // Never a value: no share, no day, nothing but the two lists of ids (ADR-0018 §5).
    for (const wrong of [
      { shares: [] },
      { shares: [50], daysAway: [] },
      { shares: [{ member: robin, percent: 50 }], daysAway: [] },
      { shares: [], daysAway: ['2026-10-12'] },
      { shares: robin, daysAway: [] },
      { shares: [], daysAway: [], percent: 50 },
      [robin],
    ]) {
      expect(await refusal(entry('household.started', wrong))).toBe(broken);
    }
  });
});

/** Renames household `id` from `version`, as a use case would; returns whether it did. */
const rename = (id: string, version: number, name: string) =>
  inHousehold(db, id, async (tx) => {
    const updated = await tx
      .update(households)
      .set({ name, version: nextVersion(households) })
      .where(atVersion(households, id, version))
      .returning({ id: households.id });
    return updated.length > 0;
  });

describe('atVersion and nextVersion (ADR-0019 §5)', () => {
  it('updates a row still at the version it was read at, and moves the version on', async () => {
    const { id } = await withEntry();
    expect(await rename(id, 1, 'Birch Court')).toBe(true);
    const [row] = await inHousehold(db, id, (tx) =>
      tx.select({ name: households.name, version: households.version }).from(households),
    );
    expect(row).toEqual({ name: 'Birch Court', version: 2 });
  });

  it('changes nothing at a version that has moved on', async () => {
    const { id } = await withEntry();
    await rename(id, 1, 'Birch');
    expect(await rename(id, 1, 'Cedar Row')).toBe(false);
    const [row] = await inHousehold(db, id, (tx) =>
      tx.select({ name: households.name, version: households.version }).from(households),
    );
    expect(row).toEqual({ name: 'Birch', version: 2 });
  });
});
