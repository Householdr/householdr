import { comparisons, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold } from '../plans/testing';
import { householdBurdens } from './household-burdens';

// Learned burdens reaching the plan (ADR-0003 §1–§4, ADR-0001 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

describe('householdBurdens (ADR-0003 §1–§4)', () => {
  it('charges each member by their own answers, and others at the prior', async () => {
    const h = await plannedHousehold(db);
    const vacuum = await h.task('Vacuum', 30, 'weekly', '2026-10-14');
    const bathroom = await h.task('Bathroom', 30, 'weekly', '2026-10-16');
    // Alex finds the bathroom harder than vacuuming, every time they are asked.
    await h.inIt((tx) =>
      tx.insert(comparisons).values(
        Array.from({ length: 5 }, () => ({
          householdId: h.householdId,
          memberId: h.alex,
          harderTaskId: bathroom,
          easierTaskId: vacuum,
          answeredAt: new Date('2026-10-08T08:00:00Z'),
        })),
      ),
    );
    const burdenOf = await h.inIt((tx) =>
      householdBurdens(tx, Temporal.PlainDate.from('2026-10-08')),
    );
    expect(burdenOf(bathroom, h.alex)).toBeGreaterThan(1);
    expect(burdenOf(vacuum, h.alex)).toBeLessThan(1);
    expect(burdenOf(bathroom, h.robin)).toBe(1);

    // The draft charges each assignment at its member's own burden (ADR-0001 §5).
    await draftPlan(h.scheduler, { week: '2026-10-12' });
    const rows = (await h.plan('2026-10-12'))?.rows ?? [];
    for (const row of rows) {
      const task = row.task === 'Vacuum' ? vacuum : bathroom;
      const member = row.member === 'Alex' ? h.alex : h.robin;
      expect(row.cost).toBeCloseTo(30 * burdenOf(task, member));
    }
  });
});
