import {
  accounts,
  households,
  inHousehold,
  members,
  notifications,
  plans,
  queueJob,
  startedHouseholds,
  type JobQueue,
} from '@householdr/db';
import { channelsFor, emailTime, isTooLate, type NotificationKind } from '@householdr/domain';
import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { savedOf, type SavedPreferences } from './preferences';
import { workingPush, type PushDeliveryContext } from './push-delivery';

/**
 * What the morning e-mails need: what delivering pushes needs, since whether a member has working
 * push decides whether they get the e-mail fallback (ADR-0014 §5).
 */
export type MorningEmailContext = PushDeliveryContext;

/** A member's morning e-mail from a household, as its job names it. */
interface MorningEmailJob {
  household: string;
  member: string;
}

/** How long a morning e-mail that failed waits before it is tried again (ADR-0014 §7). */
const retryAfter = Temporal.Duration.from({ minutes: 5 });

const asDate = (instant: Temporal.Instant) => new Date(instant.epochMilliseconds);
const asInstant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());

/**
 * Queues a job for each member whose morning e-mail from a household is due, while it is released
 * (ADR-0014 §5, clarification, CODE-20): the member has a notification it may still take, and their
 * quiet hours ended since it came, in the household's time zone. Each is keyed by its member, so a
 * tick that runs twice queues it once (CODE-19).
 */
export async function queueDueEmails(context: MorningEmailContext & { queue: JobQueue }) {
  if (!context.flags.isOn('morning-email')) return;
  const now = context.clock.now();
  for (const household of await startedHouseholds(context.db)) {
    await inHousehold(context.db, household, async (tx) => {
      const [zone] = await tx.select({ timeZone: households.timeZone }).from(households);
      if (!zone) return;
      const waiting = await tx
        .select({
          member: notifications.memberId,
          account: members.accountId,
          at: notifications.at,
        })
        .from(notifications)
        .innerJoin(members, eq(members.id, notifications.memberId))
        .where(
          and(isNotNull(notifications.emailAfter), lte(notifications.emailAfter, asDate(now))),
        );
      const preferences = new Map<string, SavedPreferences>();
      const due = new Set<string>();
      for (const { member, account, at } of waiting) {
        if (!account || due.has(member)) continue;
        const saved = preferences.get(account) ?? (await savedOf(tx, account));
        preferences.set(account, saved);
        const comes = emailTime(asInstant(at), saved.quietHours, zone.timeZone);
        if (Temporal.Instant.compare(comes, now) <= 0) due.add(member);
      }
      for (const member of due) {
        await queueJob(context.queue, tx, 'morning-email', { household, member });
      }
    });
  }
}

/** A morning e-mail to send now: to whom, and what it says, for the worker to write. */
export interface PreparedEmail {
  /** The address the account signs in with (ADR-0014 §5, clarification). */
  to: string;
  /** The account's culture, such as `nl-BE`, to write it in (ADR-0014 §6). */
  culture: string;
  household: string;
  /** The day it comes, in the household's time zone. */
  day: Temporal.PlainDate;
  /** What each notification is about, in the order they came. */
  notifications: {
    kind: NotificationKind;
    week: { first: Temporal.PlainDate; last: Temporal.PlainDate };
  }[];
  /** The notifications it takes, to give back if sending it fails. */
  taken: string[];
}

/**
 * Decides a member's morning e-mail from a household, now that it is due (ADR-0014 §3, §5,
 * clarifications), and returns it to send, or null. It takes each notification whose e-mail time has
 * come, in the order they came, and says those the member gets by e-mail, or by the fallback for push:
 * none for a child, and none a day after the notification. What it takes is taken off the
 * notifications first, so a job that runs again never sends it twice (ADR-0014 §7); there is none
 * while it isn't released.
 */
export async function prepareMorningEmail(
  context: MorningEmailContext,
  job: MorningEmailJob,
): Promise<PreparedEmail | null> {
  const now = context.clock.now();
  return inHousehold(context.db, job.household, async (tx) => {
    const [member] = await tx
      .select({
        role: members.role,
        account: members.accountId,
        to: accounts.email,
        culture: accounts.culture,
        household: households.name,
        timeZone: households.timeZone,
      })
      .from(members)
      .innerJoin(accounts, eq(accounts.id, members.accountId))
      .innerJoin(households, eq(households.id, members.householdId))
      .where(eq(members.id, job.member));
    if (!member?.account) return null;
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        at: notifications.at,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
      })
      .from(notifications)
      // Every notification so far is about a plan, which it goes with (`notifications_plan`).
      .innerJoin(
        plans,
        and(
          eq(plans.householdId, notifications.householdId),
          eq(plans.weekStart, notifications.week),
        ),
      )
      .where(
        and(eq(notifications.memberId, job.member), lte(notifications.emailAfter, asDate(now))),
      )
      .orderBy(asc(notifications.at), asc(notifications.id))
      .for('update', { of: notifications });
    const preferences = await savedOf(tx, member.account);
    const due = rows.filter(
      ({ at }) =>
        Temporal.Instant.compare(
          emailTime(asInstant(at), preferences.quietHours, member.timeZone),
          now,
        ) <= 0,
    );
    if (due.length === 0) return null;
    await tx
      .update(notifications)
      .set({ emailAfter: null })
      .where(
        inArray(
          notifications.id,
          due.map(({ id }) => id),
        ),
      );
    if (!context.flags.isOn('morning-email')) return null;
    const hasPush =
      context.pushOffered &&
      context.flags.isOn('push-notifications') &&
      (await workingPush(tx, member.account, now)).length > 0;
    const told = due.filter(
      ({ kind, at }) =>
        !isTooLate(asInstant(at), now) &&
        channelsFor(kind, {
          choice: preferences.channels[kind],
          child: member.role === 'child',
          hasPush,
          emailFallback: preferences.emailFallback,
        }).email,
    );
    if (told.length === 0) return null;
    return {
      to: member.to,
      culture: member.culture,
      household: member.household,
      day: now.toZonedDateTimeISO(member.timeZone).toPlainDate(),
      notifications: told.map(({ kind, weekStart, weekEnd }) => ({
        kind,
        // A plan’s end is the first day of the next week.
        week: {
          first: Temporal.PlainDate.from(weekStart),
          last: Temporal.PlainDate.from(weekEnd).subtract({ days: 1 }),
        },
      })),
      taken: told.map(({ id }) => id),
    };
  });
}

/**
 * Gives a morning e-mail that couldn't be sent back to the notifications it took, which a later
 * e-mail tries again in 5 minutes, while they still exist and are less than a day old (ADR-0014
 * §5, §7, clarifications).
 */
export async function morningEmailFailed(
  context: MorningEmailContext,
  job: MorningEmailJob & { taken: readonly string[] },
) {
  if (job.taken.length === 0) return;
  const again = asDate(context.clock.now().add(retryAfter));
  await inHousehold(context.db, job.household, (tx) =>
    tx
      .update(notifications)
      .set({ emailAfter: again })
      .where(and(inArray(notifications.id, [...job.taken]), isNull(notifications.emailAfter))),
  );
}
