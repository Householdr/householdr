import { createECDH, randomBytes } from 'node:crypto';
import {
  accounts,
  jobQueue,
  members,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  sessions,
  type Database,
  type JobQueue,
  type Jobs,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftPlan } from '../plans/draft-plan';
import { publishPlan } from '../plans/publish-plan';
import { plannedHousehold, type PlannedHousehold } from '../plans/testing';
import { settableFlags } from '../testing';
import {
  morningEmailFailed,
  prepareMorningEmail,
  queueDueEmails,
  type MorningEmailContext,
} from './morning-email';

// Deciding each member's morning e-mail from a household (ADR-0014 §3, §5, clarification), on a
// real database (TEST-11). Invented households and addresses (TEST-8).

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
const days = { first: Temporal.PlainDate.from(week), last: Temporal.PlainDate.from('2026-10-18') };
/** Friday 9 October 2026, 07:30 in Brussels, as the default quiet hours end. */
const friday = Temporal.Instant.from('2026-10-09T05:30:00Z');

/**
 * Ash Lane, with the dishes to do. On Thursday 8 October at 10:00 in Brussels, the scheduler drafts
 * the week of 12 October, which Robin, its head, hears of, and then publishes it, which Robin and
 * Alex hear of. Neither has push.
 */
const household = async () => {
  const h = await plannedHousehold(db);
  await h.task('Dishes', 20, 'daily', '2026-10-08');
  await draftPlan(h.scheduler, { week });
  await publishPlan(h.scheduler, { week });
  const [robin] = await h.inIt((tx) =>
    tx
      .select({ account: members.accountId, email: accounts.email })
      .from(members)
      .innerJoin(accounts, eq(accounts.id, members.accountId))
      .where(eq(members.id, h.robin)),
  );
  if (!robin?.account) throw new Error('No account');
  const context: MorningEmailContext = {
    db,
    clock: h.clock,
    flags: settableFlags({ 'morning-email': true, 'push-notifications': true }),
    pushOffered: true,
  };
  const job = { household: h.householdId, member: h.robin };
  return { h, account: robin.account, email: robin.email, context, job };
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

/** Until when the member's notifications may go in a morning e-mail, as stored, oldest first. */
const emailAfter = async (h: PlannedHousehold, member: string) => {
  const rows = await h.inIt((tx) =>
    tx
      .select({ after: notifications.emailAfter })
      .from(notifications)
      .where(eq(notifications.memberId, member))
      .orderBy(notifications.at, notifications.kind),
  );
  return rows.map(({ after }) => after?.toISOString() ?? null);
};

const waitingFor = async (household: string) => {
  const jobs = await queue.fetch<Jobs['morning-email']>('morning-email', { batchSize: 100 });
  return jobs.filter((j) => j.data.household === household).map((j) => j.data);
};

describe('queueDueEmails (ADR-0014 §5, clarification)', () => {
  it('queues each member’s e-mail once their quiet hours end, once, by its key', async () => {
    const { h, context } = await household();
    await queueDueEmails({ ...context, queue });
    expect(await waitingFor(h.householdId)).toEqual([]);
    h.clock.advance(h.clock.now().until(friday));
    await queueDueEmails({ ...context, queue });
    await queueDueEmails({ ...context, queue });
    const waiting = await waitingFor(h.householdId);
    expect(waiting).toContainEqual({ household: h.householdId, member: h.robin });
    expect(waiting.filter((j) => j.member === h.robin)).toHaveLength(1);
  });

  it('waits for the quiet hours each member chose', async () => {
    const { h, account, context } = await household();
    await choose(account, { quietStart: '22:00', quietEnd: '06:45' });
    h.clock.advance(h.clock.now().until(Temporal.Instant.from('2026-10-09T04:45:00Z')));
    await queueDueEmails({ ...context, queue });
    expect(await waitingFor(h.householdId)).toEqual([
      { household: h.householdId, member: h.robin },
    ]);
  });

  it('queues none while the morning e-mail isn’t released (CODE-20)', async () => {
    const { h, context } = await household();
    h.clock.advance(h.clock.now().until(friday));
    await queueDueEmails({ ...context, flags: settableFlags(), queue });
    expect(await waitingFor(h.householdId)).toEqual([]);
  });
});

describe('prepareMorningEmail (ADR-0014 §3, §5, clarification)', () => {
  it('says what the member gets by e-mail, in the order it came, to the address they sign in with, once', async () => {
    const { h, account, email, context, job } = await household();
    await choose(account, { channels: { 'plan.drafted': 'email' } });
    h.clock.advance(h.clock.now().until(friday));
    const prepared = await prepareMorningEmail(context, job);
    expect(prepared).toEqual({
      to: email,
      culture: 'en-BE',
      household: 'Ash Lane',
      day: Temporal.PlainDate.from('2026-10-09'),
      notifications: [
        { kind: 'plan.drafted', week: days },
        { kind: 'plan.published', week: days },
      ],
      taken: expect.any(Array) as unknown,
    });
    expect(prepared?.taken).toHaveLength(2);
    // Taken off the notifications before it is sent, so it never goes twice.
    expect(await emailAfter(h, h.robin)).toEqual([null, null]);
    expect(await prepareMorningEmail(context, job)).toBeNull();
  });

  it('e-mails a member without push what would have been pushed, where the catalogue says so', async () => {
    // By default, both are pushed; only the published plan falls back to e-mail (ADR-0014 §2).
    const { h, context, job } = await household();
    h.clock.advance(h.clock.now().until(friday));
    const prepared = await prepareMorningEmail(context, job);
    expect(prepared?.notifications).toEqual([{ kind: 'plan.published', week: days }]);
    // The draft's went too, with no e-mail of its own.
    expect(await emailAfter(h, h.robin)).toEqual([null, null]);
  });

  it('gives none before the member’s quiet hours end, and takes nothing', async () => {
    const { h, context, job } = await household();
    h.clock.advance(h.clock.now().until(friday.subtract({ minutes: 1 })));
    expect(await prepareMorningEmail(context, job)).toBeNull();
    expect(await emailAfter(h, h.robin)).toEqual([
      '2026-10-08T08:00:00.000Z',
      '2026-10-08T08:00:00.000Z',
    ]);
    h.clock.advance({ minutes: 1 });
    expect(await prepareMorningEmail(context, job)).not.toBeNull();
  });

  it('gives none to a member whose push works, or who turned the fallback off', async () => {
    const { h, account, context, job } = await household();
    const [session] = await db
      .insert(sessions)
      .values({
        userId: account,
        token: `token-${crypto.randomUUID()}`,
        expiresAt: new Date('2026-11-08T08:00:00Z'),
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error('No session');
    await db.insert(pushSubscriptions).values({
      accountId: account,
      sessionId: session.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
      p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    });
    h.clock.advance(h.clock.now().until(friday));
    expect(await prepareMorningEmail(context, job)).toBeNull();
    expect(await emailAfter(h, h.robin)).toEqual([null, null]);

    const other = await household();
    await choose(other.account, { emailFallback: false });
    other.h.clock.advance(other.h.clock.now().until(friday));
    expect(await prepareMorningEmail(other.context, other.job)).toBeNull();
  });

  it('falls back to e-mail while push isn’t released or offered', async () => {
    const { h, context, job } = await household();
    h.clock.advance(h.clock.now().until(friday));
    const prepared = await prepareMorningEmail({ ...context, pushOffered: false }, job);
    expect(prepared?.notifications).toEqual([{ kind: 'plan.published', week: days }]);
  });

  it('gives a child none (ADR-0014 §3)', async () => {
    const { h, context } = await household();
    await h.inIt((tx) =>
      tx
        .update(members)
        .set({ role: 'child', birthDate: '2014-05-01' })
        .where(eq(members.id, h.alex)),
    );
    h.clock.advance(h.clock.now().until(friday));
    const job = { household: h.householdId, member: h.alex };
    expect(await prepareMorningEmail(context, job)).toBeNull();
  });

  it('leaves out a notification a day old by then (ADR-0014 §4–§5, clarifications)', async () => {
    const { h, context, job } = await household();
    h.clock.advance({ hours: 24 });
    expect(await prepareMorningEmail(context, job)).toBeNull();
    expect(await emailAfter(h, h.robin)).toEqual([null, null]);
  });

  it('gives none while it isn’t released, and none comes once it is (CODE-20)', async () => {
    const { h, context, job } = await household();
    h.clock.advance(h.clock.now().until(friday));
    expect(await prepareMorningEmail({ ...context, flags: settableFlags() }, job)).toBeNull();
    expect(await prepareMorningEmail(context, job)).toBeNull();
  });

  it('gives nothing for notifications that are gone, such as with their draft', async () => {
    const { h, context, job } = await household();
    await h.inIt((tx) => tx.delete(notifications));
    h.clock.advance(h.clock.now().until(friday));
    expect(await prepareMorningEmail(context, job)).toBeNull();
  });
});

describe('morningEmailFailed (ADR-0014 §7)', () => {
  it('gives the notifications back, for an e-mail 5 minutes on', async () => {
    const { h, context, job } = await household();
    h.clock.advance(h.clock.now().until(friday));
    const prepared = await prepareMorningEmail(context, job);
    if (!prepared) throw new Error('No e-mail');
    await morningEmailFailed(context, { ...job, taken: prepared.taken });
    expect(await emailAfter(h, h.robin)).toEqual([null, '2026-10-09T05:35:00.000Z']);
    const robins = async () =>
      (await waitingFor(h.householdId)).filter((j) => j.member === h.robin);
    h.clock.advance({ minutes: 4 });
    await queueDueEmails({ ...context, queue });
    expect(await robins()).toEqual([]);
    h.clock.advance({ minutes: 1 });
    await queueDueEmails({ ...context, queue });
    expect(await robins()).toEqual([job]);
    expect(await prepareMorningEmail(context, job)).toMatchObject({
      notifications: [{ kind: 'plan.published', week: days }],
    });
  });
});
