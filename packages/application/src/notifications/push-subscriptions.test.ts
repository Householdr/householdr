import { createECDH, randomBytes } from 'node:crypto';
import { accounts, pushSubscriptions, sessions, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  devicePushEndpoints,
  removePushSubscription,
  savePushSubscription,
} from './push-subscriptions';

// Turning push on and off for a device (ADR-0014 §7, ADR-0017 §6, clarifications), on a real
// database (TEST-11). Invented accounts, endpoints and keys (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
/** An account of its own, signed in on a device: the context of that device. */
const device = async (accountId?: string) => {
  let account = accountId;
  if (!account) {
    const [row] = await db
      .insert(accounts)
      .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
      .returning({ id: accounts.id });
    account = row?.id;
  }
  if (!account) throw new Error('No account');
  const [session] = await db
    .insert(sessions)
    .values({
      userId: account,
      token: `token-${String(++next)}`,
      expiresAt: new Date('2026-11-08T08:00:00Z'),
    })
    .returning({ id: sessions.id });
  if (!session) throw new Error('No session');
  return { db, account, session: session.id };
};

/** A browser's P-256 public key and 16-byte secret, drawn for the test, in base64url. */
const browserKeys = {
  p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
};

/** A browser's subscription, as `PushSubscription.toJSON()` gives it. */
const subscription = (endpoint = `https://fcm.googleapis.com/fcm/send/${String(++next)}`) => ({
  endpoint,
  expirationTime: null,
  keys: browserKeys,
});

const endpoints = async (context: Awaited<ReturnType<typeof device>>) => {
  const result = await devicePushEndpoints(context);
  if (!result.ok) throw new Error('Not allowed');
  return result.endpoints;
};

describe('savePushSubscription (ADR-0014 §7, clarification)', () => {
  it('turns push on for the device in hand only', async () => {
    const phone = await device();
    const laptop = await device(phone.account);
    const theirs = subscription();
    expect(await savePushSubscription(phone, theirs)).toEqual({ ok: true });
    expect(await endpoints(phone)).toEqual([theirs.endpoint]);
    expect(await endpoints(laptop)).toEqual([]);
    // Saving it again changes nothing.
    expect(await savePushSubscription(phone, theirs)).toEqual({ ok: true });
    expect(await endpoints(phone)).toEqual([theirs.endpoint]);
  });

  it('refuses an endpoint on any but the known push services (ADR-0017 §6)', async () => {
    const phone = await device();
    for (const endpoint of [
      'https://push.example.org/send/abc',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://10.0.0.1/push',
    ]) {
      expect(await savePushSubscription(phone, subscription(endpoint))).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await endpoints(phone)).toEqual([]);
  });

  it('refuses keys that aren’t a P-256 public key and a 16-byte secret', async () => {
    const phone = await device();
    const keys = subscription().keys;
    for (const wrong of [
      { ...keys, p256dh: keys.p256dh.slice(1) },
      { ...keys, p256dh: `A${keys.p256dh.slice(1)}` },
      { ...keys, auth: `${keys.auth}A` },
      { ...keys, auth: `/${keys.auth.slice(1)}` },
      {},
    ]) {
      expect(await savePushSubscription(phone, { ...subscription(), keys: wrong })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await savePushSubscription(phone, null)).toEqual({ ok: false, error: 'invalid' });
  });

  it('gives a browser’s subscription to whoever turned push on there last', async () => {
    const robin = await device();
    const sam = await device();
    const shared = subscription();
    await savePushSubscription(robin, shared);
    await savePushSubscription(sam, shared);
    expect(await endpoints(robin)).toEqual([]);
    expect(await endpoints(sam)).toEqual([shared.endpoint]);
  });

  it('goes when the device is signed out (ADR-0018 §2)', async () => {
    const phone = await device();
    await savePushSubscription(phone, subscription());
    await db.delete(sessions).where(eq(sessions.id, phone.session));
    const left = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.accountId, phone.account));
    expect(left).toEqual([]);
  });
});

describe('removePushSubscription (ADR-0014 §7, clarification)', () => {
  it('turns push off for the account’s own subscription, and no one else’s', async () => {
    const robin = await device();
    const sam = await device();
    const [own, theirs] = [subscription(), subscription()];
    await savePushSubscription(robin, own);
    await savePushSubscription(sam, theirs);
    expect(await removePushSubscription(robin, { endpoint: theirs.endpoint })).toEqual({
      ok: true,
    });
    expect(await endpoints(sam)).toEqual([theirs.endpoint]);
    expect(await removePushSubscription(robin, { endpoint: own.endpoint })).toEqual({ ok: true });
    expect(await endpoints(robin)).toEqual([]);
    expect(await removePushSubscription(robin, {})).toEqual({ ok: false, error: 'invalid' });
  });
});
