import {
  absences,
  awayPeriods,
  households,
  inHousehold,
  members,
  type Transaction,
} from '@householdr/db';
import {
  can,
  householdDate,
  plannableDays,
  unplannableEnds,
  type Absence,
  type AbsenceEnd,
  type Member,
  type Role,
} from '@householdr/domain';
import { and, asc, eq, gte } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';

/** A field of the form that adds an absence, as a refusal names it. */
export type AbsenceField = 'firstDay' | 'lastDay';

const fieldOf: Record<AbsenceEnd, AbsenceField> = { from: 'firstDay', to: 'lastDay' };

const id = v.pipe(v.string(), v.uuid());

/** Whether `text` names a day that exists, which the ISO format alone allows 30 February for. */
function isDay(text: string) {
  try {
    Temporal.PlainDate.from(text, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

const day = v.pipe(
  v.string(),
  v.isoDate(),
  v.check(isDay),
  v.transform((text) => Temporal.PlainDate.from(text)),
);

/** Whose absence is added or removed (CODE-12). */
const whose = v.object({ member: id });

/**
 * The days of a new absence (CODE-12), as `YYYY-MM-DD`: whole days in the household's time zone,
 * both included (ADR-0005 §2, clarification). One that isn't a day is missing, which the domain
 * refuses along with any problem of the other. Nothing else is asked: no reason, place or detail
 * (ADR-0012 §2, ADR-0018 §3).
 */
const dayOrMissing = v.fallback(v.optional(day), undefined);
const days = v.object({ firstDay: dayOrMissing, lastDay: dayOrMissing });

/** Which absence is removed (CODE-12). */
const which = v.object({ absence: id });

/** The household's date now, which absences are planned from (ADR-0005 §2). */
async function today(tx: Transaction, context: HouseholdContext) {
  const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
  if (!household) throw new Error('The household of a member is gone.');
  return householdDate(context.clock.now(), household.timeZone);
}

/**
 * A member's profile as permissions see them. Their own second factor plays no part in who may
 * manage their availability (ADR-0018 §4), so it isn't looked up.
 */
const asMember = (row: { id: string; role: Role; accountId: string | null }): Member => ({
  id: row.id,
  role: row.role,
  hasAccount: row.accountId !== null,
  twoFactor: false,
});

const profile = { id: members.id, role: members.role, accountId: members.accountId };

/** Member `memberId` of the household, as permissions see them, if there is one. */
async function memberOf(tx: Transaction, memberId: string): Promise<Member | undefined> {
  const [row] = await tx.select(profile).from(members).where(eq(members.id, memberId));
  return row && asMember(row);
}

/**
 * Absences still current or to come on the household's date `today`: the ones the page shows and
 * that can be removed. Past ones stay as the membership's record (ADR-0012 §5).
 */
const notOver = (today: Temporal.PlainDate) => gte(absences.lastDay, today.toString());

type AddAbsenceResult =
  | { ok: true; absenceId: string }
  /** No member with that id in the household. */
  | { ok: false; error: 'not-found' }
  /**
   * The member acting may not manage that member's availability: only their own, and a head's
   * for children and profiles without an account (ADR-0005 §2, ADR-0018 §4).
   */
  | { ok: false; error: 'not-allowed' }
  /**
   * The days that can't be planned: not a date, a first day in the past, a last day before the
   * first, or a day more than a year ahead.
   */
  | { ok: false; error: 'invalid'; fields: AbsenceField[] };

/**
 * Plans an absence for a member of the household (ADR-0005 §2). It may overlap others: the domain
 * takes their union, so nothing is merged or refused.
 */
export async function addAbsence(
  context: HouseholdContext,
  input: unknown,
): Promise<AddAbsenceResult> {
  const target = v.safeParse(whose, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<AddAbsenceResult> => {
    const member = await memberOf(tx, target.output.member);
    if (!member) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'availability.manage', member })) {
      return { ok: false, error: 'not-allowed' };
    }
    const { firstDay, lastDay } = v.parse(days, input);
    const ends = unplannableEnds({ from: firstDay, to: lastDay }, await today(tx, context));
    // With no end refused, both are days; the last two checks only tell TypeScript so.
    if (ends.length > 0 || !firstDay || !lastDay) {
      return { ok: false, error: 'invalid', fields: ends.map((end) => fieldOf[end]) };
    }
    const [added] = await tx
      .insert(absences)
      .values({
        householdId: context.householdId,
        memberId: member.id,
        firstDay: firstDay.toString(),
        lastDay: lastDay.toString(),
      })
      .returning({ id: absences.id });
    if (!added) throw new Error('No absence was added.');
    return { ok: true, absenceId: added.id };
  });
}

type RemoveAbsenceResult =
  | { ok: true }
  /** No current or upcoming absence with that id in the household: it may be removed already. */
  | { ok: false; error: 'not-found' }
  /** Not an absence the member acting may manage (ADR-0005 §2, ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' };

/** Removes a current or upcoming absence (ADR-0005 §2): changing one is removing it and adding. */
export async function removeAbsence(
  context: HouseholdContext,
  input: unknown,
): Promise<RemoveAbsenceResult> {
  const parsed = v.safeParse(which, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  const absenceId = parsed.output.absence;
  return inHousehold(context.db, context.householdId, async (tx): Promise<RemoveAbsenceResult> => {
    const [found] = await tx
      .select({ memberId: absences.memberId })
      .from(absences)
      .where(and(eq(absences.id, absenceId), notOver(await today(tx, context))));
    const member = found && (await memberOf(tx, found.memberId));
    if (!member) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'availability.manage', member })) {
      return { ok: false, error: 'not-allowed' };
    }
    const removed = await tx
      .delete(absences)
      .where(eq(absences.id, absenceId))
      .returning({ id: absences.id });
    return removed.length > 0 ? { ok: true } : { ok: false, error: 'not-found' };
  });
}

/** A planned absence as the availability page shows it. */
export interface AbsenceView extends Absence {
  id: string;
}

/** A member of the household and when they are away, as every member sees it (ADR-0018 §3). */
export interface MemberAvailability {
  id: string;
  name: string;
  role: Role;
  /** Their current and upcoming absences, by first day. */
  absences: AbsenceView[];
  /** Whether the member viewing may add and remove their absences (ADR-0005 §2, ADR-0018 §4). */
  mayManage: boolean;
}

/** When the whole household is away together, which every member sees (ADR-0005 §5). */
export interface HouseholdAway {
  /** Its current and upcoming periods away, by first day. */
  periods: AbsenceView[];
  /** Whether the member viewing may add and remove them: heads only. */
  mayManage: boolean;
}

type ViewAvailabilityResult =
  | {
      ok: true;
      household: HouseholdAway;
      members: MemberAvailability[];
      /** The days a new absence can fall on, for the form's hints (CODE-12). */
      plannable: Absence;
    }
  | { ok: false; error: 'not-allowed' };

// As the household's page lists its members (ADR-0007 §1).
const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/**
 * Who in the household is away when: every member, heads first, then adults and children, each by
 * name, with their current and upcoming absences. Every member sees that others are away, as date
 * ranges, and nothing else, since nothing else is stored (ADR-0018 §3, ADR-0012 §3).
 */
export async function viewAvailability(context: HouseholdContext): Promise<ViewAvailabilityResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const date = await today(tx, context);
    const list = await tx.select({ ...profile, name: members.name }).from(members);
    list.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    const away = await tx
      .select({
        id: absences.id,
        memberId: absences.memberId,
        firstDay: absences.firstDay,
        lastDay: absences.lastDay,
      })
      .from(absences)
      .where(notOver(date))
      .orderBy(asc(absences.firstDay), asc(absences.lastDay), asc(absences.id));
    const together = await tx
      .select({ id: awayPeriods.id, firstDay: awayPeriods.firstDay, lastDay: awayPeriods.lastDay })
      .from(awayPeriods)
      .where(gte(awayPeriods.lastDay, date.toString()))
      .orderBy(asc(awayPeriods.firstDay), asc(awayPeriods.lastDay), asc(awayPeriods.id));
    return {
      ok: true as const,
      household: {
        periods: together.map((period) => ({
          id: period.id,
          from: Temporal.PlainDate.from(period.firstDay),
          to: Temporal.PlainDate.from(period.lastDay),
        })),
        mayManage: can(context.member, { action: 'household.away' }),
      },
      plannable: plannableDays(date),
      members: list.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        absences: away
          .filter((absence) => absence.memberId === row.id)
          .map((absence) => ({
            id: absence.id,
            from: Temporal.PlainDate.from(absence.firstDay),
            to: Temporal.PlainDate.from(absence.lastDay),
          })),
        mayManage: can(context.member, { action: 'availability.manage', member: asMember(row) }),
      })),
    };
  });
}

type AddAwayPeriodResult =
  | { ok: true; periodId: string }
  /** Only heads mark the household away (ADR-0005 §5), once signed in with two factors. */
  | { ok: false; error: 'not-allowed' }
  /** The days that can't be planned, by the same rule as a member's absence. */
  | { ok: false; error: 'invalid'; fields: AbsenceField[] };

/**
 * Marks a period when the whole household is away together, by a head (ADR-0005 §5). Its days are
 * planned like an absence's: from today up to a year ahead. It may overlap another: plans take
 * their union.
 */
export async function addAwayPeriod(
  context: HouseholdContext,
  input: unknown,
): Promise<AddAwayPeriodResult> {
  if (!can(context.member, { action: 'household.away' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx): Promise<AddAwayPeriodResult> => {
    const { firstDay, lastDay } = v.parse(days, input);
    const ends = unplannableEnds({ from: firstDay, to: lastDay }, await today(tx, context));
    // With no end refused, both are days; the last two checks only tell TypeScript so.
    if (ends.length > 0 || !firstDay || !lastDay) {
      return { ok: false, error: 'invalid', fields: ends.map((end) => fieldOf[end]) };
    }
    const [added] = await tx
      .insert(awayPeriods)
      .values({
        householdId: context.householdId,
        firstDay: firstDay.toString(),
        lastDay: lastDay.toString(),
      })
      .returning({ id: awayPeriods.id });
    if (!added) throw new Error('No period away was added.');
    return { ok: true, periodId: added.id };
  });
}

type RemoveAwayPeriodResult =
  | { ok: true }
  | { ok: false; error: 'not-allowed' }
  /** No current or upcoming period away with that id in the household: it may be removed already. */
  | { ok: false; error: 'not-found' };

/** Removes a current or upcoming period when the household is away, by a head (ADR-0005 §5). */
export async function removeAwayPeriod(
  context: HouseholdContext,
  input: unknown,
): Promise<RemoveAwayPeriodResult> {
  if (!can(context.member, { action: 'household.away' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(v.object({ period: id }), input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  const { period } = parsed.output;
  return inHousehold(context.db, context.householdId, async (tx) => {
    const date = await today(tx, context);
    const removed = await tx
      .delete(awayPeriods)
      .where(and(eq(awayPeriods.id, period), gte(awayPeriods.lastDay, date.toString())))
      .returning({ id: awayPeriods.id });
    return removed.length > 0
      ? { ok: true as const }
      : { ok: false as const, error: 'not-found' as const };
  });
}
