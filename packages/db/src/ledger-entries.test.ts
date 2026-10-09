import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inHousehold, type Database } from './connection';
import { households, ledgerEntries, members, plans, type LedgerKind } from './schema';
import { refusal, refusedByRowSecurity, testDatabase } from './testing';

// The ledger keeps its entries as they were (ADR-0002 §7), each household to its own (ADR-0008 §9,
// CODE-17), on a real database as the app's role (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

const week = '2026-10-12';

/** A household with Robin, its head, and a published plan for the week of 12 October 2026. */
const household = async () => {
  const id = crypto.randomUUID();
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
    const at = new Date('2026-10-11T10:00:00Z');
    await tx.insert(plans).values({
      householdId: id,
      weekStart: week,
      weekEnd: '2026-10-19',
      status: 'published',
      draftedAt: at,
      publishedAt: at,
    });
    return { id, robin: robin.id };
  });
};

/** Posts a settlement for `member` in household `id`, as that household. */
const settle = (id: string, member: string, change = -12.5, kind: LedgerKind = 'settlement') =>
  inHousehold(db, id, (tx) =>
    tx.insert(ledgerEntries).values({
      householdId: id,
      memberId: member,
      kind,
      week,
      change,
      at: new Date('2026-10-18T22:00:00Z'),
    }),
  );

describe('the ledger (ADR-0002 §7)', () => {
  it('takes and shows entries in their own household only', async () => {
    const ash = await household();
    const birch = await household();
    await settle(ash.id, ash.robin);
    const seen = (id: string) =>
      inHousehold(db, id, (tx) =>
        tx
          .select({ member: ledgerEntries.memberId, change: ledgerEntries.change })
          .from(ledgerEntries),
      );
    expect(await seen(ash.id)).toEqual([{ member: ash.robin, change: -12.5 }]);
    expect(await seen(birch.id)).toEqual([]);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
  });

  it('can’t be changed or deleted by the app (`migrate.ts`)', async () => {
    const { id, robin } = await household();
    await settle(id, robin);
    // PostgreSQL's code for a missing privilege.
    expect(
      await refusal(inHousehold(db, id, (tx) => tx.update(ledgerEntries).set({ change: 0 }))),
    ).toBe('42501');
    expect(await refusal(inHousehold(db, id, (tx) => tx.delete(ledgerEntries)))).toBe('42501');
  });

  it('settles a member’s week once (CODE-19)', async () => {
    const { id, robin } = await household();
    await settle(id, robin);
    expect(await refusal(settle(id, robin, 3))).toBe('ledger_entries_settled_once');
  });

  it('takes only the kinds it knows', async () => {
    const { id, robin } = await household();
    expect(await refusal(settle(id, robin, 0, 'correction' as LedgerKind))).toBe(
      'ledger_entries_kind',
    );
  });

  it('never refers to another household’s member or plan week, or to a week without a plan', async () => {
    const ash = await household();
    const birch = await household();
    // Foreign keys are checked past row-level security, so each key includes the household.
    expect(await refusal(settle(ash.id, birch.robin))).toBe('ledger_entries_member');
    const elsewhere = inHousehold(db, ash.id, async (tx) => {
      await tx.delete(plans);
      await tx.insert(ledgerEntries).values({
        householdId: ash.id,
        memberId: ash.robin,
        kind: 'settlement',
        week,
        change: 0,
        at: new Date(),
      });
    });
    expect(await refusal(elsewhere)).toBe('ledger_entries_week');
  });

  it('can’t be added to another household', async () => {
    const ash = await household();
    const birch = await household();
    const added = inHousehold(db, ash.id, (tx) =>
      tx.insert(ledgerEntries).values({
        householdId: birch.id,
        memberId: birch.robin,
        kind: 'settlement',
        week,
        change: 30,
        at: new Date(),
      }),
    );
    expect(await refusal(added)).toBe(refusedByRowSecurity);
  });
});
