import {
  absences,
  activityLog,
  households,
  inHousehold,
  members,
  temporaryShares,
  type SetBeforeStart,
  type Transaction,
} from '@householdr/db';
import {
  can,
  comingPlanTimes,
  firstPlanWeek,
  householdDate,
  startChoices,
  type StartChoice,
} from '@householdr/domain';
import { and, asc, eq, exists, isNotNull, isNull, or } from 'drizzle-orm';
import * as v from 'valibot';
import { draftWeek } from '../plans/draft-plan';
import { planningOf } from '../plans/planning';
import type { HouseholdContext } from './membership';

/** What starting sends (CODE-12): when the household starts. */
const startInput = v.object({ when: v.picklist(startChoices) });

/**
 * Starting is for heads with two factors (ADR-0007 §2, ADR-0010 §3): it ends setting up and sets
 * when plans begin, a setting of the household's like its week start day.
 */
const mayStart = (context: HouseholdContext) =>
  can(context.member, { action: 'household.settings' });

type StartOptionsResult =
  | {
      ok: true;
      /** The household's time zone, which its times are in. */
      timeZone: string;
      /** Starting now: this plan week is planned at once, from today to its last day. */
      now: { today: Temporal.PlainDate; last: Temporal.PlainDate };
      /**
       * Starting on the week start day: the first plan week, and when the heads see its draft and
       * everyone its plan, as the scheduler makes them (ADR-0006 §2).
       */
      weekStart: {
        week: Temporal.PlainDate;
        draftAt: Temporal.ZonedDateTime;
        publishAt: Temporal.ZonedDateTime;
      };
    }
  /** Only heads start the household, once signed in with two factors. */
  | { ok: false; error: 'not-allowed' }
  /** It is no longer in setup (ADR-0007 §2). */
  | { ok: false; error: 'already-started' };

/**
 * What a head chooses between to start the household, while it is in setup (ADR-0007 §2 step 7,
 * §3): starting now, with this week planned for the days left, or on the week start day.
 */
export async function startOptions(context: HouseholdContext): Promise<StartOptionsResult> {
  if (!mayStart(context)) return { ok: false, error: 'not-allowed' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<StartOptionsResult> => {
    const planning = await planningOf(tx);
    if (planning.firstWeek) return { ok: false, error: 'already-started' };
    const now = context.clock.now();
    const { calendar, timings } = planning;
    const { timeZone } = calendar;
    const thisWeek = firstPlanWeek('now', now, calendar);
    const nextWeek = firstPlanWeek('week start', now, calendar);
    const times = comingPlanTimes(now, nextWeek, calendar, timings);
    return {
      ok: true,
      timeZone,
      now: { today: householdDate(now, timeZone), last: thisWeek.end.subtract({ days: 1 }) },
      weekStart: {
        week: nextWeek.start,
        draftAt: times.draft.toZonedDateTimeISO(timeZone),
        publishAt: times.publish.toZonedDateTimeISO(timeZone),
      },
    };
  });
}

type StartHouseholdResult =
  | {
      ok: true;
      when: StartChoice;
      /** The first day of its first plan week. */
      firstWeek: Temporal.PlainDate;
      /**
       * Whether this week's draft is ready for the heads to check and publish: when starting now,
       * unless the household is away for the rest of the week.
       */
      drafted: boolean;
    }
  /** Only heads start the household, once signed in with two factors. */
  | { ok: false; error: 'not-allowed' }
  /** Neither now nor on the week start day. */
  | { ok: false; error: 'invalid' }
  /** It was started already, by this head or another: it starts once (ADR-0007 §2). */
  | { ok: false; error: 'already-started' };

/**
 * Starts the household, which ends setting it up (ADR-0007 §2 step 7, §3), by a head. It records
 * the first plan week: this one when it starts now, whose draft is made at once for the days left,
 * with the days before today counted as days away, for a head to check and publish; or the next
 * one when it starts on the week start day, which the scheduler drafts and publishes at its times
 * (ADR-0006 §2). The activity log shows who started it, with what was set before, their own
 * share included, never a value (ADR-0018 §5).
 */
export async function startHousehold(
  context: HouseholdContext,
  input: unknown,
): Promise<StartHouseholdResult> {
  if (!mayStart(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(startInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { when } = parsed.output;
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<StartHouseholdResult> => {
    // Locked, so a household starts once however many heads start it at the same moment.
    const planning = await planningOf(tx, { lock: true });
    if (planning.firstWeek) return { ok: false, error: 'already-started' };
    const now = context.clock.now();
    const week = firstPlanWeek(when, now, planning.calendar);
    await tx
      .update(households)
      .set({ firstPlanWeek: week.start.toString(), startedNow: when === 'now' })
      .where(eq(households.id, householdId));
    await tx.insert(activityLog).values({
      householdId,
      at: new Date(now.epochMilliseconds),
      actorId: context.member.id,
      action: 'household.started',
      setBeforeStart: await setBeforeStart(tx),
    });
    if (when === 'week start') return { ok: true, when, firstWeek: week.start, drafted: false };
    const planId = await draftWeek(tx, {
      householdId,
      planning: { ...planning, firstWeek: week.start },
      week,
      now,
      replacing: undefined,
    });
    return { ok: true, when, firstWeek: week.start, drafted: planId !== undefined };
  });
}

/**
 * What heads set before the household started (ADR-0007 §2, ADR-0018 §5, clarifications): whose
 * share was set, as a share of their own or a temporary one, which only heads set (ADR-0001 §4),
 * the starting head's own included (ADR-0018 §4); and which profiles without an account have days
 * away, which only a head acting for them plans (ADR-0018 §4). Ids only, in a fixed order.
 */
async function setBeforeStart(tx: Transaction): Promise<SetBeforeStart> {
  const temporaryShare = tx
    .select({ id: temporaryShares.id })
    .from(temporaryShares)
    .where(eq(temporaryShares.memberId, members.id));
  const shares = await tx
    .select({ id: members.id })
    .from(members)
    .where(or(isNotNull(members.sharePercent), exists(temporaryShare)))
    .orderBy(asc(members.id));
  const absence = tx
    .select({ id: absences.id })
    .from(absences)
    .where(eq(absences.memberId, members.id));
  const daysAway = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(isNull(members.accountId), exists(absence)))
    .orderBy(asc(members.id));
  return { shares: shares.map((row) => row.id), daysAway: daysAway.map((row) => row.id) };
}
