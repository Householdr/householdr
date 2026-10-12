import { inHousehold, members, temporaryShares } from '@householdr/db';
import { can, setShares, temporaryShareDays } from '@householdr/domain';
import { and, eq, gte, lte } from 'drizzle-orm';
import * as v from 'valibot';
import { changeLog } from '../households/change-log';
import type { HouseholdContext } from '../households/membership';
import {
  seen,
  shareColumns,
  sharesOf,
  thisWeek,
  type MemberShare,
  type PlannedShare,
} from './member-share';

const id = v.pipe(v.string(), v.uuid());

/** A day of the calendar as `YYYY-MM-DD`: one that exists, unlike 30 February. */
const day = v.pipe(
  v.string(),
  v.isoDate(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try {
      return Temporal.PlainDate.from(dataset.value);
    } catch {
      // The format allows up to 31 days in any month.
      addIssue();
      return NEVER;
    }
  }),
);

/**
 * What adding a temporary share sends (CODE-12): its days, both included, from this plan week's
 * first day up to a year from today, and its share, as a head sets one (ADR-0001 §4).
 */
const fields = (days: { earliest: Temporal.PlainDate; latest: Temporal.PlainDate }) => {
  const within = (date: Temporal.PlainDate) =>
    Temporal.PlainDate.compare(date, days.earliest) >= 0 &&
    Temporal.PlainDate.compare(date, days.latest) <= 0;
  return v.pipe(
    v.object({
      firstDay: v.pipe(day, v.check(within)),
      lastDay: v.pipe(day, v.check(within)),
      percent: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(setShares.min),
        v.maxValue(setShares.max),
      ),
    }),
    // The last day can't come before the first, whatever else is wrong.
    v.forward(
      v.partialCheck(
        [['firstDay'], ['lastDay']],
        ({ firstDay, lastDay }) => Temporal.PlainDate.compare(firstDay, lastDay) <= 0,
      ),
      ['lastDay'],
    ),
  );
};

/** A field of the form that adds a temporary share. */
export type TemporaryShareField = 'firstDay' | 'lastDay' | 'percent';

const order: TemporaryShareField[] = ['firstDay', 'lastDay', 'percent'];

/** What adding a temporary share sends, before it is checked. */
export interface TemporaryShareInput {
  member: unknown;
  firstDay: unknown;
  lastDay: unknown;
  percent: unknown;
}

type AddTemporaryShareResult =
  | { ok: true; share: MemberShare }
  /** Only heads change shares, once signed in with two factors (ADR-0001 §4, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'not-found' }
  /** The fields that aren't valid, in the form's order. */
  | { ok: false; error: 'invalid'; fields: TemporaryShareField[] }
  /** The member has a temporary share on one of its days already, which it can't overlap. */
  | { ok: false; error: 'overlap'; overlapping: PlannedShare };

/**
 * Adds a temporary share for a member, by a head (ADR-0001 §4): on the days it covers, it is their
 * share instead of the one set or the default, and it never overlaps another of theirs
 * (clarification), which the member's lock makes sure of. No reason is asked or kept (ADR-0012 §2).
 * Once the household has started, the activity log shows that one was planned for the member, never
 * its days or share (ADR-0018 §5); before, the start entry lists it (ADR-0007 §2, clarification).
 */
export async function addTemporaryShare(
  context: HouseholdContext,
  input: TemporaryShareInput,
): Promise<AddTemporaryShareResult> {
  const memberId = input.member;
  if (!v.is(id, memberId)) return { ok: false, error: 'not-found' };
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<AddTemporaryShareResult> => {
    const log = await changeLog(tx, context);
    const [row] = await tx
      .select(shareColumns)
      .from(members)
      .where(eq(members.id, memberId))
      .for('update');
    if (!row) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'share.edit', member: seen(row) })) {
      return { ok: false, error: 'not-allowed' };
    }
    const now = await thisWeek(tx, context);
    const parsed = v.safeParse(fields(temporaryShareDays(now.today, now.calendar)), input);
    if (!parsed.success) {
      const keys = new Set(parsed.issues.map(({ path }) => path?.[0]?.key));
      return { ok: false, error: 'invalid', fields: order.filter((field) => keys.has(field)) };
    }
    const firstDay = parsed.output.firstDay.toString();
    const lastDay = parsed.output.lastDay.toString();
    const [overlapping] = await tx
      .select({
        id: temporaryShares.id,
        firstDay: temporaryShares.firstDay,
        lastDay: temporaryShares.lastDay,
        percent: temporaryShares.percent,
      })
      .from(temporaryShares)
      .where(
        and(
          eq(temporaryShares.memberId, memberId),
          lte(temporaryShares.firstDay, lastDay),
          gte(temporaryShares.lastDay, firstDay),
        ),
      )
      .limit(1);
    if (overlapping) return { ok: false, error: 'overlap', overlapping };
    const { percent } = parsed.output;
    await tx.insert(temporaryShares).values({ householdId, memberId, firstDay, lastDay, percent });
    await log('temporary-share.added', memberId);
    const [share] = await sharesOf(tx, [row], now);
    if (!share) throw new Error('No share for a member.');
    return { ok: true, share };
  });
}

type RemoveTemporaryShareResult =
  | { ok: true; share: MemberShare }
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'not-found' };

/**
 * Removes a member's temporary share, by a head (ADR-0001 §4). Once the household has started, the
 * activity log shows that one of the member's was removed, never which (ADR-0018 §5).
 */
export async function removeTemporaryShare(
  context: HouseholdContext,
  input: { id: unknown },
): Promise<RemoveTemporaryShareResult> {
  const shareId = input.id;
  if (!v.is(id, shareId)) return { ok: false, error: 'not-found' };
  return inHousehold(context.db, context.householdId, async (tx) => {
    const log = await changeLog(tx, context);
    const [row] = await tx
      .select(shareColumns)
      .from(temporaryShares)
      .innerJoin(members, eq(members.id, temporaryShares.memberId))
      .where(eq(temporaryShares.id, shareId))
      .for('update', { of: members });
    if (!row) return { ok: false as const, error: 'not-found' as const };
    if (!can(context.member, { action: 'share.edit', member: seen(row) })) {
      return { ok: false as const, error: 'not-allowed' as const };
    }
    await tx.delete(temporaryShares).where(eq(temporaryShares.id, shareId));
    await log('temporary-share.removed', row.id);
    const [share] = await sharesOf(tx, [row], await thisWeek(tx, context));
    if (!share) throw new Error('No share for a member.');
    return { ok: true as const, share };
  });
}
