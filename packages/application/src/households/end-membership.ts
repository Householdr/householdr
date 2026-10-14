import {
  absences,
  assignments,
  comparisons,
  completionCredits,
  completions,
  invitations,
  ledgerEntries,
  members,
  parentalConsents,
  plans,
  temporaryShares,
  unavailabilities,
  type Transaction,
} from '@householdr/db';
import { householdDate } from '@householdr/domain';
import { and, eq, gt, gte, lte, or, sql } from 'drizzle-orm';
import { redraftOpen } from '../plans/draft-plan';
import type { Planning } from '../plans/planning';
import { reallocateLeaver } from '../plans/reallocate';

/** When a membership ends, and in which household. */
interface Ending {
  householdId: string;
  planning: Planning;
  now: Temporal.Instant;
}

/**
 * Ends member `memberId`'s membership at `now`, at once (ADR-0005 §4, clarifications): they become
 * a former member, without an account or a share of their own, shown as "Former member" unless
 * `showsName`. They leave every plan of a week not yet over: their open occurrences in a published
 * one go to others, or are left unassigned, and a draft is drafted again without them. Their fair
 * portion of this week counts up to now. Their comparison answers and invitation link go, and their
 * absences, times they couldn't and temporary shares that start after now; the others go once this
 * week is settled, which counts them. A profile with nothing to keep is deleted instead. Its caller
 * holds the household's planning lock, as drafting does, and decides who may end it.
 */
export async function endMembership(
  tx: Transaction,
  { householdId, planning, now }: Ending,
  memberId: string,
  { showsName }: { showsName: boolean },
) {
  const keep = await hasHistory(tx, memberId, householdDate(now, planning.calendar.timeZone));
  const leftAt = new Date(now.epochMilliseconds);
  await tx
    .update(members)
    .set({
      leftAt,
      accountId: null,
      sharePercent: null,
      showsName,
      namedHead: false,
      version: sql`${members.version} + 1`,
    })
    .where(eq(members.id, memberId));
  await reallocateLeaver(tx, { planning, now }, memberId);
  await redraftOpen(tx, { householdId, planning, now });

  // Burden evidence goes when the member leaves (ADR-0012 §5), as does an invitation link.
  await tx.delete(comparisons).where(eq(comparisons.memberId, memberId));
  await tx.delete(invitations).where(eq(invitations.memberId, memberId));
  const today = householdDate(now, planning.calendar.timeZone).toString();
  await tx
    .delete(absences)
    .where(and(eq(absences.memberId, memberId), gt(absences.firstDay, today)));
  await tx
    .delete(temporaryShares)
    .where(and(eq(temporaryShares.memberId, memberId), gt(temporaryShares.firstDay, today)));
  await tx
    .delete(unavailabilities)
    .where(and(eq(unavailabilities.memberId, memberId), gte(unavailabilities.startsAt, leftAt)));
  if (!keep) await tx.delete(members).where(eq(members.id, memberId));
}

/**
 * Whether member `memberId` has history to stay in as a former member (ADR-0005 §4,
 * clarification): an occurrence in a published plan, or a published plan of a week begun by
 * `today` that was drafted once they had joined, which the week's settlement counts them in; a
 * completion they did or logged; a ledger entry; or a consent record.
 */
async function hasHistory(tx: Transaction, memberId: string, today: Temporal.PlainDate) {
  const [member] = await tx
    .select({ joinedAt: members.joinedAt })
    .from(members)
    .where(eq(members.id, memberId));
  if (!member) throw new Error('No such member.');
  const queries = [
    () =>
      tx
        .select({ id: assignments.id })
        .from(assignments)
        .innerJoin(plans, eq(plans.id, assignments.planId))
        .where(and(eq(assignments.memberId, memberId), eq(plans.status, 'published')))
        .limit(1),
    () =>
      tx
        .select({ id: plans.id })
        .from(plans)
        .where(
          and(
            eq(plans.status, 'published'),
            lte(plans.weekStart, today.toString()),
            gte(plans.draftedAt, member.joinedAt),
          ),
        )
        .limit(1),
    () =>
      tx
        .select({ id: completions.id })
        .from(completions)
        .leftJoin(completionCredits, eq(completionCredits.completionId, completions.id))
        .where(or(eq(completions.loggedBy, memberId), eq(completionCredits.memberId, memberId)))
        .limit(1),
    () =>
      tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.memberId, memberId))
        .limit(1),
    () =>
      tx
        .select({ id: parentalConsents.id })
        .from(parentalConsents)
        .where(eq(parentalConsents.memberId, memberId))
        .limit(1),
  ];
  for (const query of queries) {
    if ((await query()).length > 0) return true;
  }
  return false;
}
