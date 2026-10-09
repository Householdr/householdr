import { inHousehold, ledgerEntries, members, plans, type Transaction } from '@householdr/db';
import { can, type RebalancePreset, type Role } from '@householdr/domain';
import { desc, eq, sql } from 'drizzle-orm';
import type { HouseholdContext } from '../households/context';
import { planningOf } from '../plans/planning';

/**
 * Each member's balance in points, by member id: the sum of their ledger entries (ADR-0002 §7),
 * positive when ahead of their fair portion. A member without entries, such as one who just
 * joined, has none here, which is a balance of 0 (ADR-0005 §4).
 */
export async function balancesOf(tx: Transaction): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      member: ledgerEntries.memberId,
      balance: sql<number>`sum(${ledgerEntries.change})`.mapWith(Number),
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.memberId);
  return new Map(rows.map((row) => [row.member, row.balance]));
}

/** A plan week a member's balance was settled for, and what that changed it by (ADR-0002 §1). */
export interface SettledWeek {
  /** Its first day, and the day after its last. */
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
  /** In points: what they did that week less what they owed. */
  change: number;
}

/** A member's balance and its history, as every member sees them (ADR-0002 §6). */
export interface MemberBalance {
  id: string;
  name: string;
  /** In points: positive is ahead of their fair portion, negative behind. */
  balance: number;
  /** What each settled week changed it by, newest first. */
  history: SettledWeek[];
}

type HouseholdBalancesResult =
  | {
      ok: true;
      /** How fast the plans even the balances out (ADR-0002 §3). */
      rebalance: RebalancePreset;
      /** Every member, heads first, then adults and children, each by name. */
      members: MemberBalance[];
    }
  | { ok: false; error: 'not-allowed' };

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/**
 * Every member's balance and its history, which every member of the household sees (ADR-0002 §6),
 * children included. The history is what each settled week changed the balance by, and nothing
 * else: what a member owed and did would tell their share and how hard they find their tasks, which
 * stay private (ADR-0018 §4, ADR-0003 §5), so neither is kept. It goes back to the household's first
 * settled week: the 3-month limit on detailed history is our hosted service's free plan's
 * (ADR-0013 §3), which the core doesn't know about.
 */
export async function householdBalances(
  context: HouseholdContext,
): Promise<HouseholdBalancesResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const { rebalance } = await planningOf(tx);
    const people = await tx
      .select({ id: members.id, name: members.name, role: members.role })
      .from(members);
    people.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    const balances = await balancesOf(tx);
    const settled = await tx
      .select({
        member: ledgerEntries.memberId,
        start: plans.weekStart,
        end: plans.weekEnd,
        change: ledgerEntries.change,
      })
      .from(ledgerEntries)
      .innerJoin(plans, eq(plans.weekStart, ledgerEntries.week))
      .where(eq(ledgerEntries.kind, 'settlement'))
      .orderBy(desc(ledgerEntries.week));
    return {
      ok: true as const,
      rebalance,
      members: people.map(({ id, name }) => ({
        id,
        name,
        balance: balances.get(id) ?? 0,
        history: settled
          .filter((entry) => entry.member === id)
          .map((entry) => ({
            start: Temporal.PlainDate.from(entry.start),
            end: Temporal.PlainDate.from(entry.end),
            change: entry.change,
          })),
      })),
    };
  });
}
