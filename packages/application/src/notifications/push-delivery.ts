import {
  accounts,
  households,
  inHousehold,
  members,
  notifications,
  plans,
  pushSubscriptions,
  queueJob,
  sentPushes,
  sessions,
  startedHouseholds,
  type Database,
  type JobQueue,
  type Transaction,
} from '@householdr/db';
import {
  channelsFor,
  isKnownPushService,
  isTooLate,
  pushTime,
  underCeiling,
  type NotificationKind,
} from '@householdr/domain';
import { and, eq, gt, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import type { Clock, Flags, PushOutcome, PushTarget } from '../ports';
import { savedOf } from './preferences';

/**
 * What delivering pushes needs: the database, the time, the flags, and whether the instance offers
 * push at all, which it doesn't without VAPID keys (ADR-0014 §7, clarification).
 */
export interface PushDeliveryContext {
  db: Database;
  clock: Clock;
  flags: Flags;
  pushOffered: boolean;
}

/** A notification's push, as its job names it. */
interface PushJob {
  household: string;
  notification: string;
}

/** How long a push that failed waits before it is tried again (ADR-0014 §7). */
const retryAfter = Temporal.Duration.from({ minutes: 5 });
/** How long the times pushes were sent are kept (ADR-0012 §2, clarification). */
const sentKept = Temporal.Duration.from({ hours: 48 });

const asDate = (instant: Temporal.Instant) => new Date(instant.epochMilliseconds);

/**
 * Queues a job for each notification whose push is due, household by household, while push is
 * offered and released (ADR-0014 §7, CODE-20). Each is keyed by its notification, so a tick that
 * runs twice queues it once (CODE-19). Notifications so far are all about plans, which only
 * households past setup have.
 */
export async function queueDuePushes(context: PushDeliveryContext & { queue: JobQueue }) {
  if (!context.pushOffered || !context.flags.isOn('push-notifications')) return;
  const now = asDate(context.clock.now());
  for (const household of await startedHouseholds(context.db)) {
    await inHousehold(context.db, household, async (tx) => {
      const due = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(isNotNull(notifications.pushAfter), lte(notifications.pushAfter, now)));
      for (const { id } of due) {
        await queueJob(context.queue, tx, 'notification-push', { household, notification: id });
      }
    });
  }
}

/** A push to send now: to whom, where, and what it says, for the worker to write. */
export interface PreparedPush {
  account: string;
  /** The account's culture, such as `nl-BE`, to write it in (ADR-0014 §6). */
  culture: string;
  targets: PushTarget[];
  household: string;
  kind: NotificationKind;
  /** The first and last day of the week of the plan it is about. */
  week: { first: Temporal.PlainDate; last: Temporal.PlainDate };
}

/** Never again: the notification stays in the list, with no push to come (ADR-0014 §4). */
const noPush = (tx: Transaction, id: string) =>
  tx.update(notifications).set({ pushAfter: null }).where(eq(notifications.id, id));

/**
 * Decides a notification's push, now that it is due (ADR-0014 §3–§5, §7, clarifications), and
 * returns it to send, or null. None while push isn't offered or released, for a member who chose
 * no push or has no device with it on, a day after the notification, or over the daily ceiling:
 * the notification stays in the list. One due in quiet hours waits until they end, in the
 * household's time zone. A push to send is taken off the notification first, so a job that runs
 * again never sends it twice (ADR-0014 §7).
 */
export async function preparePush(
  context: PushDeliveryContext,
  job: PushJob,
): Promise<PreparedPush | null> {
  const now = context.clock.now();
  return inHousehold(context.db, job.household, async (tx) => {
    const [row] = await tx
      .select({
        at: notifications.at,
        kind: notifications.kind,
        role: members.role,
        account: members.accountId,
        culture: accounts.culture,
        household: households.name,
        timeZone: households.timeZone,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
      })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.memberId))
      .innerJoin(accounts, eq(accounts.id, members.accountId))
      .innerJoin(households, eq(households.id, notifications.householdId))
      .innerJoin(
        plans,
        and(
          eq(plans.householdId, notifications.householdId),
          eq(plans.weekStart, notifications.week),
        ),
      )
      .where(and(eq(notifications.id, job.notification), lte(notifications.pushAfter, asDate(now))))
      .for('update', { of: notifications });
    if (!row?.account) return null;
    const notifiedAt = Temporal.Instant.fromEpochMilliseconds(row.at.getTime());
    if (!context.pushOffered || !context.flags.isOn('push-notifications')) {
      await noPush(tx, job.notification);
      return null;
    }
    const preferences = await savedOf(tx, row.account);
    // Only devices still signed in, on a push service still known (ADR-0014 §7, ADR-0017 §6).
    const targets = (
      await tx
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
        .where(
          and(eq(pushSubscriptions.accountId, row.account), gt(sessions.expiresAt, asDate(now))),
        )
    ).filter((target) => isKnownPushService(target.endpoint));
    const { push } = channelsFor(row.kind, {
      choice: preferences.channels[row.kind],
      child: row.role === 'child',
      hasPush: targets.length > 0,
      emailFallback: preferences.emailFallback,
    });
    if (!push || isTooLate(notifiedAt, now)) {
      await noPush(tx, job.notification);
      return null;
    }
    const when = pushTime(now, preferences.quietHours, row.timeZone);
    if (Temporal.Instant.compare(when, now) > 0) {
      await tx
        .update(notifications)
        .set({ pushAfter: asDate(when) })
        .where(eq(notifications.id, job.notification));
      return null;
    }
    const sent = await tx
      .select({ at: sentPushes.sentAt })
      .from(sentPushes)
      .where(
        and(
          eq(sentPushes.accountId, row.account),
          gte(sentPushes.sentAt, asDate(now.subtract({ hours: 25 }))),
        ),
      );
    const times = sent.map(({ at }) => Temporal.Instant.fromEpochMilliseconds(at.getTime()));
    await noPush(tx, job.notification);
    if (!underCeiling(times, now, row.timeZone)) return null;
    return {
      account: row.account,
      culture: row.culture,
      targets,
      household: row.household,
      kind: row.kind,
      week: {
        first: Temporal.PlainDate.from(row.weekStart),
        last: Temporal.PlainDate.from(row.weekEnd).subtract({ days: 1 }),
      },
    };
  });
}

/**
 * Records what came of a notification's push (ADR-0014 §4, §7, clarifications): when it was sent,
 * for the daily ceiling; the subscriptions the push service no longer knows, deleted; and, if no
 * device took it but some may later, the push due again in 5 minutes, while the notification still
 * exists.
 */
export async function pushSent(
  context: PushDeliveryContext,
  job: PushJob & { account: string; outcomes: { endpoint: string; outcome: PushOutcome }[] },
) {
  const now = context.clock.now();
  const of = (outcome: PushOutcome) =>
    job.outcomes.filter((o) => o.outcome === outcome).map((o) => o.endpoint);
  const gone = of('gone');
  if (gone.length > 0) {
    await context.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.accountId, job.account),
          inArray(pushSubscriptions.endpoint, gone),
        ),
      );
  }
  if (of('sent').length > 0) {
    await context.db.insert(sentPushes).values({ accountId: job.account, sentAt: asDate(now) });
  } else if (of('failed').length > 0) {
    await inHousehold(context.db, job.household, (tx) =>
      tx
        .update(notifications)
        .set({ pushAfter: asDate(now.add(retryAfter)) })
        .where(eq(notifications.id, job.notification)),
    );
  }
}

/** Forgets when pushes were sent, two days on (ADR-0012 §2, clarification). Runs twice harmlessly. */
export async function deleteExpiredPushes(context: { db: Database; clock: Clock }) {
  const before = asDate(context.clock.now().subtract(sentKept));
  await context.db.delete(sentPushes).where(lt(sentPushes.sentAt, before));
}
