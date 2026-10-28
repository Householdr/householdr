import { createHash, randomBytes } from 'node:crypto';
import {
  nextVersion,
  notificationPreferences,
  unsubscribeTokens,
  type Database,
  type Transaction,
} from '@householdr/db';
import { withoutEmail } from '@householdr/domain';
import { and, eq, gt, lte } from 'drizzle-orm';
import * as v from 'valibot';
import type { Clock } from '../ports';
import { savedOf } from './preferences';

/** How long an unsubscribe link works: 30 days from the e-mail (ADR-0017 §4, clarification). */
const lifetime = { hours: 30 * 24 };

const hashOf = (token: string) => createHash('sha256').update(token).digest('base64url');

/** What opening and using an unsubscribe link need: no signed-in account. */
interface UnsubscribeContext {
  db: Database;
  clock: Clock;
}

/**
 * A new unsubscribe link's token for `account`, for an e-mail sent at `now` (ADR-0014 §6, ADR-0017
 * §4, clarifications): random, stored only as its hash, for 30 days. Expired ones go as it is made.
 */
export async function newUnsubscribeToken(
  tx: Transaction,
  account: string,
  now: Temporal.Instant,
): Promise<string> {
  const at = new Date(now.epochMilliseconds);
  await tx.delete(unsubscribeTokens).where(lte(unsubscribeTokens.expiresAt, at));
  const token = randomBytes(32).toString('base64url');
  await tx.insert(unsubscribeTokens).values({
    tokenHash: hashOf(token),
    accountId: account,
    expiresAt: new Date(now.add(lifetime).epochMilliseconds),
  });
  return token;
}

const tokenInput = v.pipe(v.string(), v.minLength(1), v.maxLength(200));

/** The account whose unsubscribe link `token` is, while it works. */
async function accountOf(db: Database | Transaction, token: unknown, now: Temporal.Instant) {
  const parsed = v.safeParse(tokenInput, token);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ account: unsubscribeTokens.accountId })
    .from(unsubscribeTokens)
    .where(
      and(
        eq(unsubscribeTokens.tokenHash, hashOf(parsed.output)),
        gt(unsubscribeTokens.expiresAt, new Date(now.epochMilliseconds)),
      ),
    );
  return row?.account ?? null;
}

/**
 * Whether unsubscribe link `token` still works, for its page to say so before anything is pressed.
 * Opening the link changes nothing, since mail filters open links too (ADR-0014 §6, clarification).
 */
export async function unsubscribeLinkWorks(
  context: UnsubscribeContext,
  token: unknown,
): Promise<boolean> {
  return (await accountOf(context.db, token, context.clock.now())) !== null;
}

type UnsubscribeResult =
  | { ok: true }
  /** Not a link that works: used already, older than 30 days, or never made. */
  | { ok: false; error: 'expired' };

/**
 * The one-click unsubscribe (ADR-0014 §6, clarification): without signing in, turns off every
 * e-mail choice of the account whose link `token` is, and the e-mail fallback. Account and security
 * e-mails keep coming. The link works once; the settings page then shows the choices as they are.
 */
export async function unsubscribe(
  context: UnsubscribeContext,
  token: unknown,
): Promise<UnsubscribeResult> {
  return context.db.transaction(async (tx): Promise<UnsubscribeResult> => {
    const account = await accountOf(tx, token, context.clock.now());
    if (account === null) return { ok: false, error: 'expired' };
    await tx
      .delete(unsubscribeTokens)
      .where(eq(unsubscribeTokens.tokenHash, hashOf(String(token))));
    const saved = await savedOf(tx, account);
    const { channels, emailFallback } = withoutEmail(saved);
    const values = {
      channels,
      quietStart: saved.quietHours.start.toString({ smallestUnit: 'minute' }),
      quietEnd: saved.quietHours.end.toString({ smallestUnit: 'minute' }),
      emailFallback,
    };
    const table = {
      id: notificationPreferences.accountId,
      version: notificationPreferences.version,
    };
    await tx
      .insert(notificationPreferences)
      .values({ accountId: account, ...values, version: 1 })
      .onConflictDoUpdate({
        target: notificationPreferences.accountId,
        set: { channels, emailFallback, version: nextVersion(table) },
      });
    return { ok: true };
  });
}
