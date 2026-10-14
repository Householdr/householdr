import { inHousehold, members } from '@householdr/db';
import { can } from '@householdr/domain';
import { and, eq, ne } from 'drizzle-orm';
import * as v from 'valibot';
import { planningOf } from '../plans/planning';
import { endMembership } from './end-membership';
import { isCurrentMember } from './former-members';
import type { HouseholdContext } from './membership';

/**
 * What leaving sends (CODE-12): how the household's history shows the member from now on, as
 * "Former member" or under their name (ADR-0018 §2, clarification). Nothing else is asked, no
 * reason (ADR-0018 §2).
 */
const leaving = v.object({ shownAs: v.picklist(['former member', 'name']) });

type LeaveHouseholdResult =
  | { ok: true }
  /**
   * Not a member who can leave on their own: a child can't (ADR-0010 §10), or they left a moment
   * ago.
   */
  | { ok: false; error: 'not-allowed' }
  /**
   * The household's last head, who is asked to name a successor first (ADR-0005 §4, ADR-0018 §2):
   * not built yet.
   */
  | { ok: false; error: 'last-head' }
  /** Not a way to be shown. */
  | { ok: false; error: 'invalid' };

/**
 * The member acting leaves the household, at once and without anyone's permission (ADR-0005 §4,
 * ADR-0018 §2, with their clarifications): they become a former member, shown as they chose, and
 * leave every plan of a week not yet over. The household sees only that they are no longer in it:
 * nothing is logged and nobody is told (ADR-0018 §8).
 */
export async function leaveHousehold(
  context: HouseholdContext,
  input: unknown,
): Promise<LeaveHouseholdResult> {
  const self = context.member;
  if (!can(self, { action: 'member.leave', member: self })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(leaving, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<LeaveHouseholdResult> => {
    // Locked, as drafting locks it: leaving changes plans.
    const planning = await planningOf(tx, { lock: true });
    const [current] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, self.id), isCurrentMember))
      .for('update');
    if (!current) return { ok: false, error: 'not-allowed' };
    if (self.role === 'head') {
      const [otherHead] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.role, 'head'), ne(members.id, self.id), isCurrentMember));
      if (!otherHead) return { ok: false, error: 'last-head' };
    }
    await endMembership(tx, { householdId, planning, now: context.clock.now() }, self.id, {
      showsName: parsed.output.shownAs === 'name',
    });
    return { ok: true };
  });
}
