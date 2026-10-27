import { inHousehold, members, unavailablePeriods, type Transaction } from '@householdr/db';
import { can, householdDate, planWeek, type Member } from '@householdr/domain';
import { and, eq, gt } from 'drizzle-orm';
import * as v from 'valibot';
import { changeLog } from '../households/change-log';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from '../plans/planning';
import { reallocateUnavailable } from '../plans/reallocate';

const id = v.pipe(v.string(), v.uuid());

/** Who can't, and the last day they can't on, as `YYYY-MM-DD` (CODE-12). Never a reason. */
const reportInput = v.object({ member: id, lastDay: v.pipe(v.string(), v.isoDate()) });

/** Whose "I can't" ends (CODE-12). */
const endInput = v.object({ member: id });

/** Member `memberId` of the household, as permissions see them, if there is one. */
async function memberOf(tx: Transaction, memberId: string): Promise<Member | undefined> {
  const [row] = await tx
    .select({ id: members.id, role: members.role, accountId: members.accountId })
    .from(members)
    .where(eq(members.id, memberId));
  return (
    row && { id: row.id, role: row.role, hasAccount: row.accountId !== null, twoFactor: false }
  );
}

/** Member `memberId`'s "I can't" that lasts at `now`, if any. */
async function lasting(tx: Transaction, memberId: string, now: Date) {
  const [period] = await tx
    .select({ id: unavailablePeriods.id, start: unavailablePeriods.start })
    .from(unavailablePeriods)
    .where(and(eq(unavailablePeriods.memberId, memberId), gt(unavailablePeriods.end, now)));
  return period;
}

type ReportUnavailableResult =
  | { ok: true }
  /** No member with that id in the household. */
  | { ok: false; error: 'not-found' }
  /**
   * The member acting may not manage that member's availability: only their own, and a head's for
   * children and profiles without an account (ADR-0005 §2, ADR-0018 §4).
   */
  | { ok: false; error: 'not-allowed' }
  /** The last day isn't today or a later day of the current plan week. */
  | { ok: false; error: 'invalid' };

/**
 * Reports that a member can't, "I can't today" (ADR-0005 §3, clarification): from now to the end of
 * `lastDay`, today or a later day of the current plan week. Reporting it again while it lasts moves
 * its end. What they can no longer do in this week's published plan is re-allocated at once; nothing
 * moves back when its end comes earlier. A head acting for a profile without an account is logged
 * once the household has started, never the days (ADR-0018 §5).
 */
export async function reportUnavailable(
  context: HouseholdContext,
  input: unknown,
): Promise<ReportUnavailableResult> {
  const target = v.safeParse(endInput, input);
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
      const parsed = v.safeParse(reportInput, input);
      if (!parsed.success) return { ok: false, error: 'invalid' };
      const planning = await planningOf(tx);
      const { timeZone } = planning.calendar;
      const now = context.clock.now();
      const today = householdDate(now, timeZone);
      const week = planWeek(today, planning.calendar);
      let lastDay: Temporal.PlainDate;
      try {
        lastDay = Temporal.PlainDate.from(parsed.output.lastDay, { overflow: 'reject' });
      } catch {
        return { ok: false, error: 'invalid' };
      }
      if (
        Temporal.PlainDate.compare(lastDay, today) < 0 ||
        Temporal.PlainDate.compare(lastDay, week.end) >= 0
      ) {
        return { ok: false, error: 'invalid' };
      }
      const end = new Date(
        lastDay.add({ days: 1 }).toZonedDateTime({ timeZone }).epochMilliseconds,
      );
      const at = new Date(now.epochMilliseconds);
      const current = await lasting(tx, member.id, at);
      if (current) {
        await tx
          .update(unavailablePeriods)
          .set({ end })
          .where(eq(unavailablePeriods.id, current.id));
      } else {
        await tx
          .insert(unavailablePeriods)
          .values({ householdId: context.householdId, memberId: member.id, start: at, end });
      }
      await reallocateUnavailable(tx, { planning, now }, member.id);
      if (!member.hasAccount) await log('unavailable.reported', member.id);
      return { ok: true };
    },
  );
}

type EndUnavailableResult =
  { ok: true } | { ok: false; error: 'not-found' } | { ok: false; error: 'not-allowed' };

/**
 * "I can after all" (ADR-0005 §3, clarification): ends a member's "I can't" at once, so it counts
 * up to now only. What it re-allocated stays where it went. Ending one that has ended already
 * changes nothing (CODE-19).
 */
export async function endUnavailable(
  context: HouseholdContext,
  input: unknown,
): Promise<EndUnavailableResult> {
  const parsed = v.safeParse(endInput, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<EndUnavailableResult> => {
    const log = await changeLog(tx, context);
    const member = await memberOf(tx, parsed.output.member);
    if (!member) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'availability.manage', member })) {
      return { ok: false, error: 'not-allowed' };
    }
    const at = new Date(context.clock.now().epochMilliseconds);
    const current = await lasting(tx, member.id, at);
    if (!current) return { ok: true };
    if (current.start < at) {
      await tx
        .update(unavailablePeriods)
        .set({ end: at })
        .where(eq(unavailablePeriods.id, current.id));
    } else {
      await tx.delete(unavailablePeriods).where(eq(unavailablePeriods.id, current.id));
    }
    if (!member.hasAccount) await log('unavailable.ended', member.id);
    return { ok: true };
  });
}

/**
 * Each member's "I can't" that lasts at `now`, by member: the last day it covers, which is all
 * others see of it (ADR-0018 §3).
 */
export async function unavailableUntil(
  tx: Transaction,
  now: Temporal.Instant,
  timeZone: string,
): Promise<Map<string, Temporal.PlainDate>> {
  const rows = await tx
    .select({ memberId: unavailablePeriods.memberId, end: unavailablePeriods.end })
    .from(unavailablePeriods)
    .where(gt(unavailablePeriods.end, new Date(now.epochMilliseconds)));
  return new Map(
    rows.map((row) => [
      row.memberId,
      householdDate(Temporal.Instant.fromEpochMilliseconds(row.end.getTime()), timeZone).subtract({
        days: 1,
      }),
    ]),
  );
}
