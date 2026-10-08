import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { rateLimits } from './auth-schema';
import type { Database, Transaction } from './connection';

/** One count an attempt goes under, and how long a number of failures makes the next one wait. */
export interface Limit {
  key: string;
  waitAfter: (failures: number) => Temporal.Duration;
}

/** An attempt `countAttempt` counted, with what its counts were before, to take it back. */
export interface CountedAttempt {
  at: Temporal.Instant;
  before: ReadonlyMap<string, { changedAt: Temporal.Instant; expiresAt: Temporal.Instant }>;
}

const asDate = (instant: Temporal.Instant) => new Date(instant.epochMilliseconds);
const asInstant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());
const isAfter = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) > 0;

/**
 * Counts an attempt at `now` under every limit, as a failure until it turns out not to be one
 * (`withdrawAttempt`), unless a limit still makes it wait: then nothing is counted and the answer
 * is until when (ADR-0010 §2, clarification). Concurrent attempts queue on the counts' rows, so a
 * burst of them can't slip in before the first ones are counted. A count is forgotten
 * `forgetAfter` after it last went up.
 */
export async function countAttempt(
  db: Database,
  limits: readonly Limit[],
  now: Temporal.Instant,
  forgetAfter: Temporal.Duration,
): Promise<{ waitUntil: Temporal.Instant } | { counted: CountedAttempt }> {
  await deleteForgotten(db, now);
  const keys = [...new Set(limits.map((limit) => limit.key))].sort();
  return db.transaction(async (tx) => {
    // A forgotten count to lock, for a key never counted. Keys go in one order, so two attempts
    // can't each hold a count the other one waits for.
    const forgotten = { count: 0, changedAt: asDate(now), expiresAt: asDate(now) };
    await tx
      .insert(rateLimits)
      .values(keys.map((key) => ({ key, ...forgotten })))
      .onConflictDoNothing();
    const rows = await tx
      .select()
      .from(rateLimits)
      .where(inArray(rateLimits.key, keys))
      .orderBy(rateLimits.key)
      .for('update');
    const counts = new Map(
      rows
        .filter((row) => isAfter(asInstant(row.expiresAt), now))
        .map((row) => [
          row.key,
          {
            count: row.count,
            changedAt: asInstant(row.changedAt),
            expiresAt: asInstant(row.expiresAt),
          },
        ]),
    );
    let waitUntil: Temporal.Instant | undefined;
    for (const limit of limits) {
      const counted = counts.get(limit.key);
      if (!counted || counted.count === 0) continue;
      const until = counted.changedAt.add(limit.waitAfter(counted.count));
      if (isAfter(until, now) && (!waitUntil || isAfter(until, waitUntil))) waitUntil = until;
    }
    if (waitUntil) return { waitUntil };
    const before = new Map<string, { changedAt: Temporal.Instant; expiresAt: Temporal.Instant }>();
    for (const key of keys) {
      const counted = counts.get(key);
      before.set(key, counted ?? { changedAt: now, expiresAt: now });
      const next = {
        count: (counted?.count ?? 0) + 1,
        changedAt: asDate(now),
        expiresAt: asDate(now.add(forgetAfter)),
      };
      await tx
        .insert(rateLimits)
        .values({ key, ...next })
        .onConflictDoUpdate({ target: rateLimits.key, set: next });
    }
    return { counted: { at: now, before } };
  });
}

/**
 * Takes back an attempt counted under `key` that wasn't a failure. Unless another attempt has
 * counted since, the count also gets back the times it had, so the next attempt waits only on the
 * failures and is forgotten when they would be.
 */
export async function withdrawAttempt(
  db: Database,
  attempt: CountedAttempt,
  key: string,
): Promise<void> {
  const before = attempt.before.get(key);
  if (!before) return;
  const ours = sql`${rateLimits.changedAt} = ${asDate(attempt.at)}`;
  await db
    .update(rateLimits)
    .set({
      count: sql`${rateLimits.count} - 1`,
      changedAt: sql`case when ${ours} then ${asDate(before.changedAt)} else ${rateLimits.changedAt} end`,
      expiresAt: sql`case when ${ours} then ${asDate(before.expiresAt)} else ${rateLimits.expiresAt} end`,
    })
    .where(and(eq(rateLimits.key, key), gt(rateLimits.count, 0)));
}

/** Forgets the count under `key` at once. */
export async function forgetCount(db: Database, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/**
 * Deletes the counts forgotten by `now` (ADR-0012 §5, clarification). Counts another attempt holds
 * are left for the next time, so cleaning never waits on an attempt or deadlocks with one.
 */
async function deleteForgotten(db: Database, now: Temporal.Instant) {
  const forgotten = db
    .select({ key: rateLimits.key })
    .from(rateLimits)
    .where(lte(rateLimits.expiresAt, asDate(now)))
    .for('update', { skipLocked: true });
  await db.delete(rateLimits).where(inArray(rateLimits.key, forgotten));
}

/** At most `max` in every `window`, counted from the first. */
export interface Allowance {
  key: string;
  max: number;
  window: Temporal.Duration;
}

/**
 * Counts one more under every allowance at `now`, inside `tx`, unless one of them is used up:
 * then nothing is counted and the answer is false (ADR-0017 §5, clarification). A window starts
 * with its first count and is forgotten when it ends. Concurrent counts queue on the rows.
 */
export async function countAllowed(
  tx: Database | Transaction,
  allowances: readonly Allowance[],
  now: Temporal.Instant,
): Promise<boolean> {
  const keys = [...new Set(allowances.map((allowance) => allowance.key))].sort();
  const ended = { count: 0, changedAt: asDate(now), expiresAt: asDate(now) };
  await tx
    .insert(rateLimits)
    .values(keys.map((key) => ({ key, ...ended })))
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(rateLimits)
    .where(inArray(rateLimits.key, keys))
    .orderBy(rateLimits.key)
    .for('update');
  const open = new Map(
    rows.filter((row) => isAfter(asInstant(row.expiresAt), now)).map((row) => [row.key, row]),
  );
  if (allowances.some((allowance) => (open.get(allowance.key)?.count ?? 0) >= allowance.max)) {
    return false;
  }
  for (const allowance of allowances) {
    const row = open.get(allowance.key);
    const next = {
      count: (row?.count ?? 0) + 1,
      changedAt: asDate(now),
      expiresAt: row?.expiresAt ?? asDate(now.add(allowance.window)),
    };
    await tx.update(rateLimits).set(next).where(eq(rateLimits.key, allowance.key));
  }
  return true;
}
