import { inHousehold, unavailabilities, type Transaction } from '@householdr/db';
import { can, suddenUnavailability } from '@householdr/domain';
import { and, eq, gt } from 'drizzle-orm';
import * as v from 'valibot';
import { changeLog } from '../households/change-log';
import type { HouseholdContext } from '../households/context';
import { planningOf, weekInput } from '../plans/planning';
import { memberOf } from './whose';

const id = v.pipe(v.string(), v.uuid());

/** Whose "I can't today" it is (CODE-12). */
const whose = v.object({ member: id });

/**
 * The day it lasts up to (CODE-12), as `YYYY-MM-DD`: nothing else is asked, no reason or detail
 * (ADR-0012 §2).
 */
const until = v.object({ lastDay: weekInput.entries.week });

/** The member's "I can't today" that hasn't ended at `now`, if any. */
const current = (memberId: string, now: Date) =>
  and(eq(unavailabilities.memberId, memberId), gt(unavailabilities.endsAt, now));

type ReportUnavailableResult =
  | { ok: true }
  /** No member with that id in the household. */
  | { ok: false; error: 'not-found' }
  /**
   * The member acting may not report that member: only themselves, and a head for children and
   * profiles without an account (ADR-0005 §3, ADR-0018 §4).
   */
  | { ok: false; error: 'not-allowed' }
  /** Not a day it can last up to: today, or a later day of this plan week. */
  | { ok: false; error: 'invalid' };

/**
 * Says a member can't from now to the end of `lastDay`, "I can't today" (ADR-0005 §2–§3, with its
 * clarification): today, or a later day of this plan week. Said again while it lasts, it moves its
 * end. Their fair portion of the week shrinks by that time, so it is an absence, not a deficit
 * (ADR-0002 §1). A head acting for a profile without an account is shown in the activity log once
 * the household has started, never until when (ADR-0018 §5); anyone else's own isn't logged.
 */
export async function reportUnavailable(
  context: HouseholdContext,
  input: unknown,
): Promise<ReportUnavailableResult> {
  const target = v.safeParse(whose, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  return inHousehold(
    context.db,
    context.householdId,
    async (tx): Promise<ReportUnavailableResult> => {
      const log = await changeLog(tx, context);
      const member = await memberOf(tx, target.output.member);
      if (!member) return { ok: false, error: 'not-found' };
      if (!can(context.member, { action: 'availability.manage', member })) {
        return { ok: false, error: 'not-allowed' };
      }
      const parsed = v.safeParse(until, input);
      if (!parsed.success) return { ok: false, error: 'invalid' };
      const now = context.clock.now();
      const { calendar } = await planningOf(tx);
      const period = suddenUnavailability(now, parsed.output.lastDay, calendar);
      if (!period) return { ok: false, error: 'invalid' };
      const endsAt = new Date(period.end.epochMilliseconds);
      const moved = await tx
        .update(unavailabilities)
        .set({ endsAt })
        .where(current(member.id, new Date(now.epochMilliseconds)))
        .returning({ id: unavailabilities.id });
      if (moved.length === 0) {
        await tx.insert(unavailabilities).values({
          householdId: context.householdId,
          memberId: member.id,
          startsAt: new Date(now.epochMilliseconds),
          endsAt,
        });
      }
      if (!member.hasAccount) await log('unavailable.reported', member.id);
      return { ok: true };
    },
  );
}

type EndUnavailableResult =
  | { ok: true }
  /** No member with that id, or they can already: it ended, or someone ended it a moment ago. */
  | { ok: false; error: 'not-found' }
  /** Not a member whose availability the member acting manages (ADR-0005 §3, ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' };

/**
 * Says a member can after all (ADR-0005 §3, clarification): their "I can't today" ends now, and
 * counts up to now only. Nothing moved because of it moves back. Logged as reporting it is.
 */
export async function endUnavailable(
  context: HouseholdContext,
  input: unknown,
): Promise<EndUnavailableResult> {
  const target = v.safeParse(whose, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<EndUnavailableResult> => {
    const log = await changeLog(tx, context);
    const member = await memberOf(tx, target.output.member);
    if (!member) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'availability.manage', member })) {
      return { ok: false, error: 'not-allowed' };
    }
    const now = new Date(context.clock.now().epochMilliseconds);
    if (!(await endNow(tx, member.id, now))) return { ok: false, error: 'not-found' };
    if (!member.hasAccount) await log('unavailable.ended', member.id);
    return { ok: true };
  });
}

/**
 * Ends the member's current "I can't today" at `now`, or removes it if it starts no earlier, so
 * it never ends before it starts. Returns whether there was one.
 */
async function endNow(tx: Transaction, memberId: string, now: Date) {
  const rows = await tx
    .select({ id: unavailabilities.id, startsAt: unavailabilities.startsAt })
    .from(unavailabilities)
    .where(current(memberId, now));
  for (const row of rows) {
    const which = eq(unavailabilities.id, row.id);
    if (row.startsAt < now) await tx.update(unavailabilities).set({ endsAt: now }).where(which);
    else await tx.delete(unavailabilities).where(which);
  }
  return rows.length > 0;
}
