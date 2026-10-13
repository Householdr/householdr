import { households, members, type Transaction } from '@householdr/db';
import { householdDate, type Member, type Role } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import type { HouseholdContext } from '../households/context';

// What the use cases about availability share: whose it is, and the household's date.

/** The household's date now, which absences are planned from (ADR-0005 §2). */
export async function today(tx: Transaction, context: HouseholdContext) {
  const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
  if (!household) throw new Error('The household of a member is gone.');
  return householdDate(context.clock.now(), household.timeZone);
}

/**
 * A member's profile as permissions see them. Their own second factor plays no part in who may
 * manage their availability (ADR-0018 §4), so it isn't looked up.
 */
export const asMember = (row: { id: string; role: Role; accountId: string | null }): Member => ({
  id: row.id,
  role: row.role,
  hasAccount: row.accountId !== null,
  twoFactor: false,
});

export const profile = { id: members.id, role: members.role, accountId: members.accountId };

/** Member `memberId` of the household, as permissions see them, if there is one. */
export async function memberOf(tx: Transaction, memberId: string): Promise<Member | undefined> {
  const [row] = await tx.select(profile).from(members).where(eq(members.id, memberId));
  return row && asMember(row);
}
