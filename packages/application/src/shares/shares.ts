import {
  atVersion,
  households,
  inHousehold,
  members,
  nextVersion,
  type Transaction,
} from '@householdr/db';
import {
  can,
  setShares,
  weekShare,
  type HouseholdCalendar,
  type Member,
  type Role,
  type ShareBasis,
} from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';

/** A member's share, as they and the heads see it, and nobody else (ADR-0018 §4). */
export interface MemberShare {
  id: string;
  name: string;
  role: Role;
  /** Their share this plan week, in whole percent of a full share (ADR-0001 §4). */
  percent: number;
  /** The share a head set instead of the default by role and age, if any. */
  set: number | null;
  /** What a change is made from (ADR-0019 §5). */
  version: number;
}

type HouseholdSharesResult =
  | {
      ok: true;
      /** Heads first, then adults and children, each by name. */
      shares: MemberShare[];
      /** Whether the reader may change them, which only heads do (ADR-0001 §4). */
      mayChange: boolean;
    }
  | { ok: false; error: 'not-allowed' };

/**
 * The shares the reader may see: their own, and every member's for a head (ADR-0018 §4, ADR-0012
 * §3), as they stand this plan week.
 */
export async function householdShares(context: HouseholdContext): Promise<HouseholdSharesResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const week = await thisWeek(tx, context);
    const rows = await tx.select(shareColumns).from(members);
    const shares = rows
      .filter((row) => can(context.member, { action: 'share.view', member: seen(row) }))
      .map((row) => shareOf(row, week))
      .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    const mayChange = rows.some((row) =>
      can(context.member, { action: 'share.edit', member: seen(row) }),
    );
    return { ok: true as const, shares, mayChange };
  });
}

const memberId = v.pipe(v.string(), v.uuid());

/** What changing a share sends (CODE-12): a whole percent, or none for the default. */
const changedShare = v.object({
  member: memberId,
  percent: v.nullable(
    v.pipe(v.number(), v.integer(), v.minValue(setShares.min), v.maxValue(setShares.max)),
  ),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

/** What changing a share sends, before it is checked. */
export interface ShareChange {
  member: unknown;
  percent: unknown;
  version: unknown;
}

type ChangeShareResult =
  | { ok: true; share: MemberShare }
  /** Only heads change shares, once signed in with two factors (ADR-0001 §4, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'not-found' }
  | { ok: false; error: 'invalid' }
  /** Someone changed the member since the form was loaded, so nothing was saved (ADR-0019 §5). */
  | { ok: false; error: 'conflict'; current: MemberShare };

/**
 * Sets a member's share, or puts it back to the default by role and age (`percent: null`), by a
 * head (ADR-0001 §4), from the version they saw (ADR-0019 §5). No reason is asked or kept (ADR-0012
 * §2). The household is still in setup, so the activity log shows nothing yet: what heads set for
 * others before Start is one entry at Start (ADR-0007 §2, ADR-0018 §5, clarifications).
 */
export async function changeShare(
  context: HouseholdContext,
  input: ShareChange,
): Promise<ChangeShareResult> {
  const id = input.member;
  if (!v.is(memberId, id)) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [row] = await tx
      .select(shareColumns)
      .from(members)
      .where(eq(members.id, id))
      .for('update');
    if (!row) return { ok: false as const, error: 'not-found' as const };
    if (!can(context.member, { action: 'share.edit', member: seen(row) })) {
      return { ok: false as const, error: 'not-allowed' as const };
    }
    const parsed = v.safeParse(changedShare, input);
    if (!parsed.success) return { ok: false as const, error: 'invalid' as const };
    const { percent, version } = parsed.output;
    const week = await thisWeek(tx, context);
    const conflict = () => ({
      ok: false as const,
      error: 'conflict' as const,
      current: shareOf(row, week),
    });
    if (row.version !== version) return conflict();
    if (row.sharePercent === percent) return { ok: true as const, share: shareOf(row, week) };
    const [updated] = await tx
      .update(members)
      .set({ sharePercent: percent, version: nextVersion(members) })
      .where(atVersion(members, id, version))
      .returning(shareColumns);
    // The row is locked, so it is still at the version read.
    if (!updated) throw new Error('A locked member changed.');
    return { ok: true as const, share: shareOf(updated, week) };
  });
}

const shareColumns = {
  id: members.id,
  name: members.name,
  role: members.role,
  birthDate: members.birthDate,
  accountId: members.accountId,
  sharePercent: members.sharePercent,
  version: members.version,
};

interface Row {
  id: string;
  name: string;
  role: Role;
  birthDate: string | null;
  accountId: string | null;
  sharePercent: number | null;
  version: number;
}

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/** A member as permissions see the one acted on (ADR-0018 §4). */
const seen = (row: Row): Member => ({
  id: row.id,
  role: row.role,
  hasAccount: row.accountId !== null,
  twoFactor: false,
});

/** Today in the household's time zone, and its calendar, which place this plan week. */
interface Week {
  today: Temporal.PlainDate;
  calendar: HouseholdCalendar;
}

async function thisWeek(tx: Transaction, context: HouseholdContext): Promise<Week> {
  const [household] = await tx
    .select({
      timeZone: households.timeZone,
      weekStartDay: households.weekStartDay,
      changeFrom: households.weekStartChangeFrom,
      previousDay: households.weekStartPreviousDay,
    })
    .from(households);
  if (!household) throw new Error('The household of a member is gone.');
  const { timeZone, weekStartDay, changeFrom, previousDay } = household;
  const today = context.clock.now().toZonedDateTimeISO(timeZone).toPlainDate();
  const calendar: HouseholdCalendar =
    changeFrom !== null && previousDay !== null
      ? {
          timeZone,
          weekStartDay,
          change: { from: Temporal.PlainDate.from(changeFrom), previous: previousDay },
        }
      : { timeZone, weekStartDay };
  return { today, calendar };
}

/** The member's share this plan week: set by a head, or by role and age (ADR-0001 §4). */
function shareOf(row: Row, { today, calendar }: Week): MemberShare {
  const set = row.sharePercent;
  const share = weekShare(
    {
      basis: basisOf(row),
      ...(set === null ? {} : { override: set / 100 }),
      temporary: [],
    },
    today,
    calendar,
  );
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    percent: Math.round(share * 100),
    set,
    version: row.version,
  };
}

function basisOf(row: Row): ShareBasis {
  if (row.role !== 'child') return { role: row.role };
  if (row.birthDate === null) throw new Error('A child without a birth date.');
  return { role: 'child', birthDate: Temporal.PlainDate.from(row.birthDate) };
}
