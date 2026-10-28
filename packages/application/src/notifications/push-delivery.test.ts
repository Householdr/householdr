import { createECDH, randomBytes } from 'node:crypto';
import {
  households,
  jobQueue,
  members,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  sentPushes,
  sessions,
  type Database,
  type JobQueue,
  type Jobs,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { settableFlags } from '../testing';
import {
  deleteExpiredPushes,
  preparePush,
  pushSent,
  queueDuePushes,
  type PushDeliveryContext,
} from './push-delivery';

// Deciding and recording each notification's push (ADR-0014 §3–§5, §7, clarifications), on a real
// database (TEST-11). Invented households, endpoints and keys (TEST-8).

let db: Database;
let close: () => Promise<void>;
let queue: JobQueue;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
  queue = await jobQueue(db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await close();
});

const week = '2026-10-12';
/** A browser's P-256 public key and 16-byte secret, of the test's own, in base64url. */
const keys = {
  p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
};

/**
 * Ash Lane, with the dishes to do, and Robin, its head, signed in on a phone that has push on.
 * The scheduler drafts the week of 12 October on Thursday 8 October at 10:00 in Brussels, so Robin
 * has a notification whose push is due.
 */
const household = async () => {
  const h = await plannedHousehold(db);
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  const [robin] = await h.inIt((tx) =>
    tx.select({ account: members.accountId }).from(members).where(eq(members.id, h.robin)),
  );
  const account = robin?.account;
  if (!account) throw new Error('No account');
  const phone = await signedIn(account);
  await draftPlan(h.scheduler, { week });
  const [notification] = await h.inIt((tx) => tx.select().from(notifications));
  if (!notification) throw new Error('No notification');
  const context: PushDeliveryContext = {
    db,
    clock: h.clock,
    flags: settableFlags({ 'push-notifications': true }),
    pushOffered: true,
  };
  const job = { household: h.householdId, notification: notification.id };
  return { h, account, phone, context, job };
};

let next = 0;
/** A device signed in to `account` until `expires`, with push on: its session and endpoint. */
const signedIn = async (account: string, expires = '2026-11-08T08:00:00Z') => {
  const [session] = await db
    .insert(sessions)
    .values({ userId: account, token: `token-${String(++next)}`, expiresAt: new Date(expires) })
    .returning({ id: sessions.id });
  if (!session) throw new Error('No session');
  const endpoint = `https://fcm.googleapis.com/fcm/send/device-${String(++next)}`;
  await db
    .insert(pushSubscriptions)
    .values({ accountId: account, sessionId: session.id, endpoint, ...keys });
  return { session: session.id, endpoint };
};

/** When the notification's push is due now, as stored. */
const dueAt = async (h: PlannedHousehold, id: string) => {
  const [row] = await h.inIt((tx) =>
    tx.select({ at: notifications.pushAfter }).from(notifications).where(eq(notifications.id, id)),
  );
  return row?.at?.toISOString() ?? null;
};

const choose = (account: string, fields: Partial<typeof notificationPreferences.$inferInsert>) =>
  db.insert(notificationPreferences).values({
    accountId: account,
    channels: {},
    quietStart: '21:30',
    quietEnd: '07:30',
    emailFallback: true,
    version: 1,
    ...fields,
  });

describe('queueDuePushes (ADR-0014 §7)', () => {
  it('queues each notification whose push is due, once, by its key', async () => {
    const { context, job } = await household();
    await queueDuePushes({ ...context, queue });
    await queueDuePushes({ ...context, queue });
    const waiting = await queue.fetch<Jobs['notification-push']>('notification-push', {
      batchSize: 100,
    });
    expect(
      waiting.filter((j) => j.data.notification === job.notification).map((j) => j.data),
    ).toEqual([job]);
  });

  it('queues none while push isn’t released or offered (CODE-20)', async () => {
    const { context, job } = await household();
    const off = { ...context, flags: settableFlags() };
    await queueDuePushes({ ...off, queue });
    await queueDuePushes({ ...context, pushOffered: false, queue });
    const waiting = await queue.fetch<Jobs['notification-push']>('notification-push', {
      batchSize: 100,
    });
    expect(waiting.filter((j) => j.data.notification === job.notification)).toEqual([]);
  });

  it('queues none from a household that closed (ADR-0018 §2, clarification)', async () => {
    const { h, context, job } = await household();
    await h.inIt((tx) => tx.update(households).set({ closedAt: new Date() }));
    await queueDuePushes({ ...context, queue });
    const waiting = await queue.fetch<Jobs['notification-push']>('notification-push', {
      batchSize: 100,
    });
    expect(waiting.filter((j) => j.data.notification === job.notification)).toEqual([]);
  });
});

describe('preparePush (ADR-0014 §3–§5, §7)', () => {
  it('gives the push to send to each of the member’s devices, once', async () => {
    const { h, account, phone, context, job } = await household();
    const laptop = await signedIn(account);
    const prepared = await preparePush(context, job);
    expect(prepared).toEqual({
      account,
      culture: 'en-BE',
      targets: expect.arrayContaining([
        { endpoint: phone.endpoint, ...keys },
        { endpoint: laptop.endpoint, ...keys },
      ]) as unknown,
      household: 'Ash Lane',
      kind: 'plan.drafted',
      week: { first: Temporal.PlainDate.from(week), last: Temporal.PlainDate.from('2026-10-18') },
    });
    expect(prepared?.targets).toHaveLength(2);
    // Taken off the notification before it is sent, so it never goes twice.
    expect(await dueAt(h, job.notification)).toBeNull();
    expect(await preparePush(context, job)).toBeNull();
  });

  it('gives none to a member who chose no push, and none comes later', async () => {
    const { h, account, context, job } = await household();
    await choose(account, { channels: { 'plan.drafted': 'app' } });
    expect(await preparePush(context, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBeNull();
  });

  it('gives none without a device that has push on and is still signed in', async () => {
    const { h, account, phone, context, job } = await household();
    await db
      .update(sessions)
      .set({ expiresAt: new Date('2026-10-08T07:00:00Z') })
      .where(eq(sessions.userId, account));
    expect(await preparePush(context, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBeNull();
    const [left] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, phone.endpoint));
    expect(left).toBeDefined();
  });

  it('holds a push due in quiet hours until they end, in the household’s time zone', async () => {
    const { h, account, context, job } = await household();
    // 10:00 in Brussels falls in quiet hours from 09:00 to 11:15.
    await choose(account, { quietStart: '09:00', quietEnd: '11:15' });
    expect(await preparePush(context, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBe('2026-10-08T09:15:00.000Z');
    // Not before.
    h.clock.advance({ minutes: 74 });
    expect(await preparePush(context, job)).toBeNull();
    h.clock.advance({ minutes: 1 });
    expect(await preparePush(context, job)).toMatchObject({ kind: 'plan.drafted' });
  });

  it('drops a push a day after its notification (ADR-0014 §4, clarification)', async () => {
    const { h, context, job } = await household();
    h.clock.advance({ hours: 24 });
    expect(await preparePush(context, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBeNull();
  });

  it('drops a sixth push on the household’s day, from any household', async () => {
    const { h, account, context, job } = await household();
    // Five already today in Brussels, the first just after its midnight.
    const times = ['2026-10-07T22:00:00Z', '2026-10-08T05:00:00Z', '2026-10-08T06:00:00Z'];
    times.push('2026-10-08T07:00:00Z', '2026-10-08T07:30:00Z');
    await db
      .insert(sentPushes)
      .values(times.map((at) => ({ accountId: account, sentAt: new Date(at) })));
    expect(await preparePush(context, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBeNull();
  });

  it('lets a fifth through, not counting yesterday’s', async () => {
    const { account, context, job } = await household();
    const times = ['2026-10-07T21:59:00Z', '2026-10-08T05:00:00Z', '2026-10-08T06:00:00Z'];
    times.push('2026-10-08T07:00:00Z', '2026-10-08T07:30:00Z');
    await db
      .insert(sentPushes)
      .values(times.map((at) => ({ accountId: account, sentAt: new Date(at) })));
    expect(await preparePush(context, job)).toMatchObject({ kind: 'plan.drafted' });
  });

  it('gives none while push isn’t released or offered, and none comes once it is (CODE-20)', async () => {
    const { h, context, job } = await household();
    expect(await preparePush({ ...context, flags: settableFlags() }, job)).toBeNull();
    expect(await dueAt(h, job.notification)).toBeNull();
    expect(await preparePush(context, job)).toBeNull();

    const other = await household();
    expect(await preparePush({ ...other.context, pushOffered: false }, other.job)).toBeNull();
    expect(await dueAt(other.h, other.job.notification)).toBeNull();
  });

  it('gives nothing for a notification that is gone, such as with its draft', async () => {
    const { h, context, job } = await household();
    await h.away('2026-10-12', '2026-10-18');
    await draftPlan(h.head, { week });
    expect(await preparePush(context, job)).toBeNull();
  });
});

describe('pushSent (ADR-0014 §4, §7)', () => {
  it('keeps when a push was sent, for the ceiling, and nothing else', async () => {
    const { account, phone, context, job } = await household();
    await preparePush(context, job);
    await pushSent(context, {
      ...job,
      account,
      outcomes: [{ endpoint: phone.endpoint, outcome: 'sent' }],
    });
    const kept = await db.select().from(sentPushes).where(eq(sentPushes.accountId, account));
    expect(kept.map((row) => row.sentAt.toISOString())).toEqual(['2026-10-08T08:00:00.000Z']);
  });

  it('deletes a subscription the push service no longer knows', async () => {
    const { account, phone, context, job } = await household();
    const laptop = await signedIn(account);
    await preparePush(context, job);
    await pushSent(context, {
      ...job,
      account,
      outcomes: [
        { endpoint: phone.endpoint, outcome: 'gone' },
        { endpoint: laptop.endpoint, outcome: 'sent' },
      ],
    });
    const left = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.accountId, account));
    expect(left).toEqual([{ endpoint: laptop.endpoint }]);
  });

  it('tries again in 5 minutes when no device took it', async () => {
    const { h, account, phone, context, job } = await household();
    await preparePush(context, job);
    await pushSent(context, {
      ...job,
      account,
      outcomes: [{ endpoint: phone.endpoint, outcome: 'failed' }],
    });
    expect(await dueAt(h, job.notification)).toBe('2026-10-08T08:05:00.000Z');
    expect(await db.select().from(sentPushes).where(eq(sentPushes.accountId, account))).toEqual([]);
  });
});

describe('deleteExpiredPushes (ADR-0012 §2, clarification)', () => {
  it('forgets when pushes were sent, two days on', async () => {
    const { account, context } = await household();
    await db.insert(sentPushes).values([
      { accountId: account, sentAt: new Date('2026-10-06T07:59:00Z') },
      { accountId: account, sentAt: new Date('2026-10-06T08:00:00Z') },
    ]);
    await deleteExpiredPushes(context);
    const kept = await db.select().from(sentPushes).where(eq(sentPushes.accountId, account));
    expect(kept.map((row) => row.sentAt.toISOString())).toEqual(['2026-10-06T08:00:00.000Z']);
  });
});
