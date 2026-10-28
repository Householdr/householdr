import { createECDH, randomBytes } from 'node:crypto';
import {
  createHousehold,
  draftPlan,
  householdNotifications,
  savePushSubscription,
  type Database,
} from '@householdr/application';
import {
  recordingMailer,
  recordingPush,
  settableClock,
  settableFlags,
} from '@householdr/application/testing';
import { currentSession, signInWithPassword } from '@householdr/auth';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workQueues } from './index';
import { deliverPush, pushContent } from './pushes';

// A notification's push, from the tick to the push port (ADR-0014 §6, §7), on a real database and
// queue (TEST-11), behind its flag (CODE-20). Invented households and endpoints (TEST-8).

let test: Awaited<ReturnType<typeof testSignInContext>>;
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const password = 'correct horse battery staple';
/** A browser's P-256 public key and 16-byte secret, of the test's own, in base64url. */
const keys = {
  p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
};

/**
 * Ash Lane, started from the week of 12 October 2026, whose head Robin has push on for a phone;
 * the scheduler then drafts that week, which Robin hears of.
 */
const household = async (db: Database, clock: ReturnType<typeof settableClock>) => {
  const email = `robin-${crypto.randomUUID()}@example.org`;
  const account = await createTestAccount(test.context.auth, { email, password });
  const created = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  await startTestHousehold(db, created.householdId, '2026-10-12');
  const signedIn = await signInWithPassword(
    test.context,
    { email, password },
    { address: '192.0.2.1', userAgent: null },
  );
  if (!signedIn.ok) throw new Error('Not signed in');
  const cookie = signedIn.cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`);
  const { session } = await currentSession(
    test.context.auth,
    new Headers({ cookie: cookie.join('; ') }),
  );
  if (!session) throw new Error('No session');
  const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
  await savePushSubscription({ db, account, session: session.id }, { endpoint, keys });
  const householdId = created.householdId;
  await draftPlan({ db, clock, householdId, member: 'scheduler' }, { week: '2026-10-12' });
  const head = { id: created.memberId, role: 'head' as const, hasAccount: true, twoFactor: true };
  const [notification] = await notificationsOf({ db, clock, householdId, member: head });
  if (!notification) throw new Error('No notification');
  return { householdId, endpoint, notification };
};

const notificationsOf = async (context: Parameters<typeof householdNotifications>[0]) => {
  const result = await householdNotifications(context);
  return result.ok ? result.notifications : [];
};

describe('pushContent (ADR-0014 §6, clarification)', () => {
  it('names the household, says what its list says, and opens the plan', () => {
    const push = {
      account: 'a',
      culture: 'nl-BE',
      targets: [],
      household: 'Ash Lane',
      week: {
        first: Temporal.PlainDate.from('2026-10-12'),
        last: Temporal.PlainDate.from('2026-10-18'),
      },
    };
    expect(pushContent({ ...push, kind: 'plan.published' }, 'h-1')).toEqual({
      title: 'Ash Lane',
      body: 'Your plan for 12–18 October 2026 is published.',
      path: '/households/h-1/plan',
    });
    // With the conventions of the account's country (ADR-0008 §6, clarification).
    expect(pushContent({ ...push, kind: 'plan.drafted', culture: 'en-US' }, 'h-1').body).toMatch(
      /^The draft plan for October 12\s–\s18, 2026 is ready for you to check\.$/,
    );
  });
});

describe('the pushes’ jobs (ADR-0014 §7)', () => {
  it('send a due push to the member’s device, from the tick, once', async () => {
    // Thursday 8 October 2026, 10:00 in Brussels.
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    const push = recordingPush();
    const context = {
      ...test.context,
      clock,
      mailer: recordingMailer(),
      push,
      origin: 'https://householdr.example.org',
      flags: settableFlags({ 'push-notifications': true }),
    };
    const { householdId, endpoint } = await household(context.db, clock);
    const queue = await workQueues(context);
    try {
      await queue.send('push-tick', {});
      await expect.poll(() => push.sent.length, { timeout: 10_000 }).toBe(1);
      expect(push.sent).toEqual([
        {
          to: { endpoint, ...keys },
          content: {
            title: 'Ash Lane',
            body: 'The draft plan for 12–18 October 2026 is ready for you to check.',
            path: `/households/${householdId}/plan`,
          },
        },
      ]);
      // A tick again sends nothing more.
      await queue.send('push-tick', {});
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(push.sent).toHaveLength(1);
    } finally {
      await queue.stop({ graceful: false });
    }
  }, 30_000);

  it('send nothing on an instance without push, and nothing is left to send', async () => {
    const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
    const flags = settableFlags({ 'push-notifications': true });
    const { householdId, notification } = await household(test.context.db, clock);
    const job = { household: householdId, notification: notification.id };
    await deliverPush({ db: test.context.db, clock, flags, push: null }, job);
    const push = recordingPush();
    await deliverPush({ db: test.context.db, clock, flags, push }, job);
    expect(push.sent).toEqual([]);
  });
});
