import { households, inHousehold, members } from '@householdr/db';
import { can, supportServiceIn, type SupportService } from '@householdr/domain';
import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { planningOf } from '../plans/planning';
import { endMembership } from './end-membership';
import { isCurrentMember } from './former-members';
import { isLastHead, successors } from './succession';
import type { HouseholdContext } from './membership';

/**
 * What leaving sends (CODE-12): how the household's history shows the member from now on, as
 * "Former member" or under their name (ADR-0018 §2, clarification), and from the household's last
 * head, who they name head, if anyone: empty leaves it to the rule (ADR-0018 §2, clarification).
 * Nothing else is asked, no reason (ADR-0018 §2).
 */
const leaving = v.object({
  shownAs: v.picklist(['former member', 'name']),
  successor: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.uuid())]), ''),
});

type LeaveHouseholdResult =
  | { ok: true }
  /**
   * Not a member who can leave on their own: a child can't (ADR-0010 §10), or they left a moment
   * ago.
   */
  | { ok: false; error: 'not-allowed' }
  /**
   * The household's last head, without another adult with an account to become head: leaving
   * closes the household (ADR-0018 §2, clarification), which isn't built yet.
   */
  | { ok: false; error: 'last-adult' }
  /** The member the last head named can't become head: not an adult of it with an account. */
  | { ok: false; error: 'successor' }
  /** Not a way to be shown, or not a member to name. */
  | { ok: false; error: 'invalid' };

/**
 * The member acting leaves the household, at once and without anyone's permission (ADR-0005 §4,
 * ADR-0018 §2, with their clarifications): they become a former member, shown as they chose, and
 * leave every plan of a week not yet over. The last head's role passes at that moment, to whoever
 * they named, who is asked later whether they take it on, or else to the adult with an account
 * longest in the household. The household sees only that they are no longer in it, and who its
 * heads are: nothing is logged and nobody is told (ADR-0018 §7–§8).
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
    const { shownAs, successor } = parsed.output;
    // The role passes as they leave (ADR-0018 §2, clarification).
    let next: { id: string; named: boolean } | null = null;
    if (await isLastHead(tx, self)) {
      const candidates = await successors(tx);
      const [longest] = candidates;
      if (!longest) return { ok: false, error: 'last-adult' };
      const named = successor === '' ? null : candidates.find(({ id }) => id === successor);
      if (named === undefined) return { ok: false, error: 'successor' };
      next = named ? { id: named.id, named: true } : { id: longest.id, named: false };
    }
    await endMembership(tx, { householdId, planning, now: context.clock.now() }, self.id, {
      showsName: shownAs === 'name',
    });
    if (next) {
      await tx
        .update(members)
        .set({ role: 'head', namedHead: next.named, version: sql`${members.version} + 1` })
        .where(eq(members.id, next.id));
    }
    return { ok: true };
  });
}

type LeaveOptionsResult =
  | {
      ok: true;
      household: string;
      /** The member's name, which they can choose to appear under (ADR-0018 §2, clarification). */
      name: string;
      /**
       * For the household's last head, who can become head as they leave, longest in it first,
       * the first being who the role goes to if they name no one (ADR-0018 §2, clarification); null
       * for anyone else. Empty when nobody can, which leaving closes the household for.
       */
      successors: { id: string; name: string }[] | null;
      /** The support service of the household's country, if there is one (ADR-0018 §8). */
      support: SupportService | null;
    }
  /** Not a member who can leave on their own (ADR-0010 §10). */
  | { ok: false; error: 'not-allowed' };

/**
 * What the leave page shows the member acting before they leave (ADR-0018 §2, §8, with their
 * clarifications): the household, their name for the choice of how its history shows them, who can
 * become head if they are the last head, and the support service for domestic violence of its
 * country.
 */
export async function leaveOptions(context: HouseholdContext): Promise<LeaveOptionsResult> {
  const self = context.member;
  if (!can(self, { action: 'member.leave', member: self })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx): Promise<LeaveOptionsResult> => {
    const [household] = await tx
      .select({ name: households.name, country: households.country })
      .from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const [own] = await tx
      .select({ name: members.name })
      .from(members)
      .where(and(eq(members.id, self.id), isCurrentMember));
    if (!own) return { ok: false, error: 'not-allowed' };
    return {
      ok: true,
      household: household.name,
      name: own.name,
      successors: (await isLastHead(tx, self)) ? await successors(tx) : null,
      support: supportServiceIn(household.country) ?? null,
    };
  });
}
