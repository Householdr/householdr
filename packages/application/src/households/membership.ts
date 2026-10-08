import {
  accountHouseholds,
  households,
  inHousehold,
  members,
  passkeys,
  type Database,
} from '@householdr/db';
import { can, type Member, type Role } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';

/** What reading households needs: the database. */
export interface HouseholdsContext {
  db: Database;
}

/** What a use case in a household needs: the household, and the member acting in it (ADR-0023 §4). */
export interface HouseholdContext extends HouseholdsContext {
  householdId: string;
  member: Member;
}

const householdId = v.pipe(v.string(), v.uuid());

/**
 * The member the signed-in account is in household `id`, as permissions see them, or null if it is
 * none of its members: what the guard checks before anything in a household (ADR-0017 §2). Head
 * powers wait for two factors, which a passkey gives (ADR-0010 §3).
 */
export async function membership(
  context: HouseholdsContext,
  accountId: string,
  id: string,
): Promise<Member | null> {
  if (!v.is(householdId, id)) return null;
  const [member] = await inHousehold(context.db, id, (tx) =>
    tx
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(eq(members.accountId, accountId)),
  );
  if (!member) return null;
  const [passkey] = await context.db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, accountId))
    .limit(1);
  return { ...member, hasAccount: true, twoFactor: passkey !== undefined };
}

/** A household of the signed-in account, as the list of them shows it. */
export interface AccountHousehold {
  id: string;
  name: string;
  /** The account's role in it. */
  role: Role;
}

/**
 * The households the signed-in account is a member of, by name: found before one is set, then each
 * read under its own row-level security (ADR-0008 §9, clarification). An account only ever lists
 * its own.
 */
export async function accountHouseholdList(
  context: HouseholdsContext,
  accountId: string,
): Promise<AccountHousehold[]> {
  const ids = await accountHouseholds(context.db, accountId);
  const list = await Promise.all(
    ids.map((id) =>
      inHousehold(context.db, id, async (tx) => {
        const [household] = await tx.select({ name: households.name }).from(households);
        const [member] = await tx
          .select({ role: members.role })
          .from(members)
          .where(eq(members.accountId, accountId));
        if (!household || !member) throw new Error('A household without the account in it.');
        return { id, name: household.name, role: member.role };
      }),
    ),
  );
  return list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** A member of the household, as the other members see them (ADR-0018 §3). */
export interface HouseholdMember {
  id: string;
  name: string;
  role: Role;
}

type ViewHouseholdResult =
  { ok: true; name: string; members: HouseholdMember[] } | { ok: false; error: 'not-allowed' };

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/**
 * The household's name and its members, heads first, then adults and children, each by name
 * (ADR-0007 §1, ADR-0018 §3).
 */
export async function viewHousehold(context: HouseholdContext): Promise<ViewHouseholdResult> {
  if (!can(context.member, { action: 'household.view' }))
    return { ok: false, error: 'not-allowed' };
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const list = await tx
      .select({ id: members.id, name: members.name, role: members.role })
      .from(members);
    list.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    return { ok: true as const, name: household.name, members: list };
  });
}
