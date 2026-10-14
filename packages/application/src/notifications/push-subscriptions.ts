import { pushSubscriptions } from '@householdr/db';
import { isKnownPushService } from '@householdr/domain';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { mayChoose, type AccountContext } from './preferences';

/** What turning push on or off needs: the account, and the session of the device in hand. */
export interface DeviceContext extends AccountContext {
  session: string;
}

/** A subscription's endpoint, on a known push service (ADR-0017 §6, clarification). */
const endpoint = v.pipe(v.string(), v.maxLength(2048), v.check(isKnownPushService));

/**
 * What a browser's subscription sends, as `PushSubscription.toJSON()` gives it (CODE-12): its
 * endpoint, its P-256 public key (65 bytes, uncompressed) and its 16-byte secret, as base64url.
 */
const subscription = v.object({
  endpoint,
  keys: v.object({
    p256dh: v.pipe(v.string(), v.regex(/^B[\w-]{86}$/)),
    auth: v.pipe(v.string(), v.regex(/^[\w-]{22}$/)),
  }),
});

type PushSubscriptionResult = { ok: true } | { ok: false; error: 'not-allowed' | 'invalid' };

/**
 * Turns push on for the device of the session (ADR-0014 §7, clarification): keeps the browser's
 * subscription with the account and that session, so it goes when the session ends. A browser has
 * one subscription per site, so one turned on before, by this account or another, is now this
 * one's.
 */
export async function savePushSubscription(
  context: DeviceContext,
  input: unknown,
): Promise<PushSubscriptionResult> {
  if (!mayChoose(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(subscription, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { endpoint, keys } = parsed.output;
  const owner = { accountId: context.account, sessionId: context.session, ...keys };
  await context.db
    .insert(pushSubscriptions)
    .values({ endpoint, ...owner })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: owner });
  return { ok: true };
}

/** Turns push off for the device whose subscription has `endpoint`, if the account holds it. */
export async function removePushSubscription(
  context: AccountContext,
  input: unknown,
): Promise<PushSubscriptionResult> {
  if (!mayChoose(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(v.object({ endpoint: v.string() }), input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  await context.db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.output.endpoint),
        eq(pushSubscriptions.accountId, context.account),
      ),
    );
  return { ok: true };
}

/**
 * The endpoints push is on for in the session of the device in hand, so its page can tell whether
 * the browser's subscription is still this account's.
 */
export async function devicePushEndpoints(
  context: DeviceContext,
): Promise<{ ok: true; endpoints: string[] } | { ok: false; error: 'not-allowed' }> {
  if (!mayChoose(context)) return { ok: false, error: 'not-allowed' };
  const rows = await context.db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.accountId, context.account),
        eq(pushSubscriptions.sessionId, context.session),
      ),
    );
  return { ok: true, endpoints: rows.map((row) => row.endpoint) };
}
