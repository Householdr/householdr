import { atVersion, inHousehold, members, nextVersion } from '@householdr/db';
import { can, setShares, temporaryShareDays, type Role } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { seen, shareColumns, sharesOf, thisWeek, type MemberShare } from './member-share';

type HouseholdSharesResult =
  | {
      ok: true;
      /** Heads first, then adults and children, each by name. */
      shares: MemberShare[];
      /** Whether the reader may change them, which only heads do (ADR-0001 §4). */
      mayChange: boolean;
      /** The days a new temporary share can cover, as `YYYY-MM-DD`. */
      temporaryDays: { earliest: string; latest: string };
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
    const now = await thisWeek(tx, context);
    const rows = await tx.select(shareColumns).from(members);
    const visible = rows.filter((row) =>
      can(context.member, { action: 'share.view', member: seen(row) }),
    );
    const shares = (await sharesOf(tx, visible, now)).sort(
      (a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name),
    );
    const mayChange = rows.some((row) =>
      can(context.member, { action: 'share.edit', member: seen(row) }),
    );
    const { earliest, latest } = temporaryShareDays(now.today, now.calendar);
    return {
      ok: true as const,
      shares,
      mayChange,
      temporaryDays: { earliest: earliest.toString(), latest: latest.toString() },
    };
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
    const now = await thisWeek(tx, context);
    const shareNow = async (current: typeof row) => {
      const [share] = await sharesOf(tx, [current], now);
      if (!share) throw new Error('No share for a member.');
      return share;
    };
    if (row.version !== version) {
      return { ok: false as const, error: 'conflict' as const, current: await shareNow(row) };
    }
    if (row.sharePercent === percent) return { ok: true as const, share: await shareNow(row) };
    const [updated] = await tx
      .update(members)
      .set({ sharePercent: percent, version: nextVersion(members) })
      .where(atVersion(members, id, version))
      .returning(shareColumns);
    // The row is locked, so it is still at the version read.
    if (!updated) throw new Error('A locked member changed.');
    return { ok: true as const, share: await shareNow(updated) };
  });
}

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };
