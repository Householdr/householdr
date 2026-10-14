import { households, inHousehold, members, type Transaction } from '@householdr/db';
import { can, type Role } from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { asMember, profile } from '../availability/whose';
import { planningOf } from '../plans/planning';
import { changeLog } from './change-log';
import type { HouseholdContext } from './context';
import { endMembership } from './end-membership';
import { isCurrentMember } from './former-members';

/** Whom a head removes (CODE-12). */
const whom = v.object({ member: v.pipe(v.string(), v.uuid()) });

/**
 * A head removing a member: besides the household and who acts, whether their sign-in is recent,
 * which removing a member needs (ADR-0010 §6).
 */
export interface RemovingContext extends HouseholdContext {
  recentSignIn: boolean;
}

/** Member `memberId` of the household now, with their name, locked until the transaction ends. */
async function removable(tx: Transaction, memberId: string) {
  const [row] = await tx
    .select({ ...profile, name: members.name })
    .from(members)
    .where(and(eq(members.id, memberId), isCurrentMember))
    .for('update');
  return row;
}

type MemberToRemoveResult =
  | {
      ok: true;
      household: string;
      name: string;
      role: Role;
      /** Whether the head has to confirm it is them first (ADR-0010 §6). */
      confirm: boolean;
    }
  /** No such member in the household now. */
  | { ok: false; error: 'not-found' }
  /** Only a head with two factors removes, and never a head or themselves (ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' };

/** The member a head is asked to confirm removing (ADR-0005 §4, clarification). */
export async function memberToRemove(
  context: RemovingContext,
  input: unknown,
): Promise<MemberToRemoveResult> {
  const parsed = v.safeParse(whom, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<MemberToRemoveResult> => {
    const row = await removable(tx, parsed.output.member);
    if (!row) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'member.remove', member: asMember(row) })) {
      return { ok: false, error: 'not-allowed' };
    }
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    return {
      ok: true,
      household: household.name,
      name: row.name,
      role: row.role,
      confirm: !context.recentSignIn,
    };
  });
}

type RemoveMemberResult =
  | { ok: true }
  /** No such member in the household now: someone removed them, or they left, a moment ago. */
  | { ok: false; error: 'not-found' }
  /** Only a head with two factors removes, and never a head or themselves (ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' }
  /** The head's sign-in isn't recent: they confirm it is them first (ADR-0010 §6). */
  | { ok: false; error: 'not-recent' };

/**
 * A head removes a member who isn't a head (ADR-0005 §4, ADR-0018 §4, with their clarifications):
 * the membership ends as it does when someone leaves, and they show as "Former member" until they
 * choose otherwise (ADR-0018 §2, clarification). It needs a recent sign-in (ADR-0010 §6), and is
 * shown in the activity log once the household has started (ADR-0018 §5). A child's account, its
 * guardians and its other households stay as they are (ADR-0010 §10).
 */
export async function removeMember(
  context: RemovingContext,
  input: unknown,
): Promise<RemoveMemberResult> {
  const parsed = v.safeParse(whom, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<RemoveMemberResult> => {
    // Before the member's row, the order Start locks them in; it holds the planning lock too.
    const log = await changeLog(tx, context);
    const planning = await planningOf(tx, { lock: true });
    const row = await removable(tx, parsed.output.member);
    if (!row) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'member.remove', member: asMember(row) })) {
      return { ok: false, error: 'not-allowed' };
    }
    if (!context.recentSignIn) return { ok: false, error: 'not-recent' };
    // Logged first, while the profile is there to be named.
    await log('member.removed', row.id);
    await endMembership(tx, { householdId, planning, now: context.clock.now() }, row.id, {
      showsName: false,
    });
    return { ok: true };
  });
}
