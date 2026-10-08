import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rateLimits } from './auth-schema';
import type { Database } from './connection';
import {
  countAllowed,
  countAttempt,
  forgetCount,
  withdrawAttempt,
  type Limit,
} from './rate-limits';
import { testDatabase } from './testing';

// The counts behind the sign-in waits (ADR-0010 §2 and ADR-0017 §5, clarifications), on a real
// database (TEST-11).

let db: Database;
let close: () => Promise<void>;
let next = 0;
const newKey = () => `key-${String(++next)}`;
const start = Temporal.Instant.from('2026-10-08T08:00:00Z');
const at = (seconds: number) => start.add({ seconds });
const day = Temporal.Duration.from({ hours: 24 });
const minute = Temporal.Duration.from({ minutes: 1 });
const none = Temporal.Duration.from({ seconds: 0 });

/** Two failures free, then a minute's wait. */
const limit = (key: string): Limit => ({ key, waitAfter: (n) => (n < 2 ? none : minute) });
const attempt = (limits: Limit[], seconds = 0) => countAttempt(db, limits, at(seconds), day);
const row = async (key: string) => {
  const [found] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  return found && { count: found.count, changedAt: found.changedAt, expiresAt: found.expiresAt };
};
const date = (seconds: number) => new Date(at(seconds).epochMilliseconds);

beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

describe('countAttempt', () => {
  it('counts each attempt, and when it came', async () => {
    const key = newKey();
    expect(await attempt([limit(key)], 0)).toHaveProperty('counted');
    expect(await attempt([limit(key)], 5)).toHaveProperty('counted');
    expect(await row(key)).toEqual({ count: 2, changedAt: date(5), expiresAt: date(5 + 86_400) });
  });

  it('turns an attempt away during a wait, without counting it', async () => {
    const key = newKey();
    await attempt([limit(key)], 0);
    await attempt([limit(key)], 5);
    expect(await attempt([limit(key)], 30)).toEqual({ waitUntil: at(65) });
    expect(await row(key)).toMatchObject({ count: 2, changedAt: date(5) });
    expect(await attempt([limit(key)], 65)).toHaveProperty('counted');
    expect(await row(key)).toMatchObject({ count: 3 });
  });

  it('waits for the longest of its limits, and counts under none of them meanwhile', async () => {
    const [waiting, free] = [newKey(), newKey()];
    await attempt([limit(waiting)], 0);
    await attempt([limit(waiting)], 10);
    expect(await attempt([limit(free), limit(waiting)], 20)).toEqual({ waitUntil: at(70) });
    expect(await row(free)).toMatchObject({ count: 0 });
  });

  it('lets no burst of attempts slip past the counts', async () => {
    const [fresh, counted] = [newKey(), newKey()];
    // A count that already exists is the one only the row lock guards; a new key's first insert
    // queues the burst by itself.
    await attempt([limit(counted)]);
    for (const [key, expected] of [
      [fresh, 2],
      [counted, 1],
    ] as const) {
      const results = await Promise.all(Array.from({ length: 10 }, () => attempt([limit(key)])));
      expect(results.filter((result) => 'counted' in result)).toHaveLength(expected);
      expect(await row(key)).toMatchObject({ count: 2 });
    }
  });

  it('forgets a count a day after it last went up', async () => {
    const [kept, forgotten] = [newKey(), newKey()];
    for (const key of [kept, forgotten]) {
      await attempt([limit(key)], 0);
      await attempt([limit(key)], 60);
    }
    await attempt([limit(kept)], 60 + 86_400 - 1);
    await attempt([limit(forgotten)], 60 + 86_400);
    expect(await row(kept)).toMatchObject({ count: 3 });
    expect(await row(forgotten)).toMatchObject({ count: 1 });
  });

  it('deletes the counts that are forgotten (ADR-0012 §5, clarification)', async () => {
    const forgotten = newKey();
    await attempt([limit(forgotten)], 0);
    await attempt([limit(newKey())], 86_400);
    expect(await row(forgotten)).toBeUndefined();
  });
});

describe('withdrawAttempt', () => {
  it('takes an attempt back, with the times the count had before it', async () => {
    const key = newKey();
    await attempt([limit(key)], 0);
    const result = await attempt([limit(key)], 30);
    if (!('counted' in result)) throw new Error('Not counted.');
    await withdrawAttempt(db, result.counted, key);
    expect(await row(key)).toEqual({ count: 1, changedAt: date(0), expiresAt: date(86_400) });
  });

  it('leaves a key never counted before forgotten', async () => {
    const key = newKey();
    const result = await attempt([limit(key)], 0);
    if (!('counted' in result)) throw new Error('Not counted.');
    await withdrawAttempt(db, result.counted, key);
    expect(await row(key)).toEqual({ count: 0, changedAt: date(0), expiresAt: date(0) });
  });

  it('keeps the times of an attempt counted since', async () => {
    const key = newKey();
    const first = await attempt([limit(key)], 0);
    await attempt([limit(key)], 10);
    if (!('counted' in first)) throw new Error('Not counted.');
    await withdrawAttempt(db, first.counted, key);
    expect(await row(key)).toEqual({ count: 1, changedAt: date(10), expiresAt: date(86_410) });
  });
});

describe('forgetCount', () => {
  it('forgets a count at once', async () => {
    const key = newKey();
    await attempt([limit(key)], 0);
    await attempt([limit(key)], 0);
    await forgetCount(db, key);
    expect(await row(key)).toBeUndefined();
    expect(await attempt([limit(key)], 1)).toHaveProperty('counted');
  });
});

describe('the counts table', () => {
  it('is unlogged, since counts needn’t survive a crash', async () => {
    const { rows } = await db.execute<{ persistence: string }>(sql`
      select relpersistence as persistence from pg_class where oid = 'auth.rate_limits'::regclass`);
    expect(rows).toEqual([{ persistence: 'u' }]);
  });
});

describe('countAllowed (ADR-0017 §5, clarification)', () => {
  const hour = Temporal.Duration.from({ hours: 1 });
  /** Three an hour and five a day under `key`. */
  const allowances = (key: string) => [
    { key: `${key}:hour`, max: 3, window: hour },
    { key: `${key}:day`, max: 5, window: day },
  ];
  const count = (key: string, seconds: number) =>
    db.transaction((tx) => countAllowed(tx, allowances(key), at(seconds)));

  it('allows up to the most a window holds, then none until it ends', async () => {
    const key = newKey();
    expect([await count(key, 0), await count(key, 60), await count(key, 120)]).toEqual([
      true,
      true,
      true,
    ]);
    expect(await count(key, 600)).toBe(false);
    // The hour started with the first count.
    expect(await count(key, 3_600)).toBe(true);
    expect(await row(`${key}:hour`)).toEqual({
      count: 1,
      changedAt: date(3_600),
      expiresAt: date(7_200),
    });
  });

  it('counts nothing when any window is full', async () => {
    const key = newKey();
    for (const seconds of [0, 1, 2, 3_600, 3_601]) expect(await count(key, seconds)).toBe(true);
    // A new hour, but the day is full: the hour's old window is left as it was.
    expect(await count(key, 7_200)).toBe(false);
    expect(await row(`${key}:hour`)).toEqual({
      count: 2,
      changedAt: date(3_601),
      expiresAt: date(7_200),
    });
    expect(await row(`${key}:day`)).toMatchObject({ count: 5 });
  });

  it('counts nothing when the transaction it is part of rolls back', async () => {
    const key = newKey();
    await db
      .transaction(async (tx) => {
        await countAllowed(tx, allowances(key), at(0));
        throw new Error('The rest fails.');
      })
      .catch(() => undefined);
    expect(await row(`${key}:hour`)).toBeUndefined();
  });

  it('lets no burst past the most a window holds', async () => {
    const key = newKey();
    const answers = await Promise.all(Array.from({ length: 10 }, () => count(key, 0)));
    expect(answers.filter(Boolean)).toHaveLength(3);
  });
});
