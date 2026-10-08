import { accounts, inHousehold, passkeys, schedules, tasks, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from '../households/create-household';
import { membership } from '../households/membership';
import { settableClock } from '../testing';
import { addTask } from './add-task';

// Adding a custom task on a simple frequency (ADR-0001 §1, ADR-0004 §3–§4, ADR-0007 §2), on a real
// database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
/** Thursday 8 October 2026, 10:00 in Brussels. */
const morning = Temporal.Instant.from('2026-10-08T08:00:00Z');

/** A household in Brussels and its founding head, as the guard finds them; with two factors unless said. */
const founded = async (twoFactor = true, now = morning) => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  if (twoFactor) {
    await db.insert(passkeys).values({
      userId: account.id,
      publicKey: 'a-key',
      credentialID: `credential-${String(++next)}`,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });
  }
  const result = await createHousehold(
    {
      db,
      actor: { account: account.id, twoFactor: true },
      account: { id: account.id, managed: false, guardians: [] },
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
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account.id, result.householdId);
  if (!member) throw new Error('Not a member');
  return { db, clock: settableClock(now), householdId: result.householdId, member };
};

/** The household's tasks as stored, with their schedules' rules. */
const stored = (householdId: string) =>
  inHousehold(db, householdId, (tx) =>
    tx
      .select({
        name: tasks.name,
        duration: tasks.duration,
        timing: tasks.timing,
        onMiss: tasks.onMiss,
        version: tasks.version,
        rules: schedules.rules,
        extraDates: schedules.extraDates,
        exceptionDates: schedules.exceptionDates,
      })
      .from(tasks)
      .innerJoin(schedules, eq(schedules.id, tasks.scheduleId)),
  );

const vacuum = { name: 'Vacuum the living room', duration: 30, frequency: 'weekly' };

describe('addTask (ADR-0001 §1, ADR-0004 §3)', () => {
  it('adds a task on a schedule of its own, from the day given', async () => {
    const head = await founded();
    const result = await addTask(head, { ...vacuum, name: '  Vacuum  ', start: '2026-10-12' });
    expect(result).toEqual({ ok: true, taskId: expect.any(String) as string, name: 'Vacuum' });
    expect(await stored(head.householdId)).toEqual([
      {
        name: 'Vacuum',
        duration: 30,
        timing: 'flexible',
        onMiss: 'roll over',
        version: 1,
        rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-12' }],
        extraDates: [],
        exceptionDates: [],
      },
    ]);
  });

  it.each([
    ['daily', 'FREQ=DAILY', 'flexible'],
    ['weekly', 'FREQ=WEEKLY', 'flexible'],
    ['biweekly', 'FREQ=WEEKLY;INTERVAL=2', 'flexible'],
    ['monthly', 'FREQ=MONTHLY', 'floating'],
    ['tri-monthly', 'FREQ=MONTHLY;INTERVAL=3', 'floating'],
    ['yearly', 'FREQ=YEARLY', 'floating'],
  ])(
    'makes a %s task %s, floating from monthly on (ADR-0004 §4)',
    async (frequency, rrule, timing) => {
      const head = await founded();
      expect(await addTask(head, { ...vacuum, frequency })).toMatchObject({ ok: true });
      expect(await stored(head.householdId)).toMatchObject([
        { rules: [{ rrule, start: '2026-10-08' }], timing, onMiss: 'roll over' },
      ]);
    },
  );

  it('starts today in the household’s time zone, across midnight and daylight saving (TEST-2)', async () => {
    for (const [now, today] of [
      // 23:59 and 00:00 in Brussels, in summer time.
      ['2026-10-08T21:59:00Z', '2026-10-08'],
      ['2026-10-08T22:00:00Z', '2026-10-09'],
      // The night summer time ends: 00:30 on 25 October, and 00:30 the next night.
      ['2026-10-24T22:30:00Z', '2026-10-25'],
      ['2026-10-25T23:30:00Z', '2026-10-26'],
    ] as const) {
      const head = await founded(true, Temporal.Instant.from(now));
      expect(await addTask(head, vacuum)).toMatchObject({ ok: true });
      expect(await stored(head.householdId)).toMatchObject([{ rules: [{ start: today }] }]);
    }
  });

  it('needs a name, of up to 100 characters', async () => {
    const head = await founded();
    for (const name of ['', '   ', 'x'.repeat(101), 42, undefined]) {
      expect(await addTask(head, { ...vacuum, name })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['name'],
      });
    }
    expect(await addTask(head, { ...vacuum, name: 'x'.repeat(100) })).toMatchObject({ ok: true });
  });

  it('needs whole minutes, from a minute to a day (ADR-0001 §5)', async () => {
    const head = await founded();
    for (const duration of [0, -5, 1441, 2.5, Number.NaN, '30', undefined]) {
      expect(await addTask(head, { ...vacuum, duration })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['duration'],
      });
    }
    for (const duration of [1, 1440]) {
      expect(await addTask(head, { ...vacuum, duration })).toMatchObject({ ok: true });
    }
  });

  it('needs one of the simple frequencies', async () => {
    const head = await founded();
    for (const frequency of ['', 'hourly', 'FREQ=WEEKLY', undefined]) {
      expect(await addTask(head, { ...vacuum, frequency })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['frequency'],
      });
    }
  });

  it('starts on a day from today up to a year from now', async () => {
    const head = await founded();
    for (const start of [
      '2026-10-07',
      '2027-10-09',
      '2026-02-30',
      '2026-13-01',
      '8 October',
      20261008,
    ]) {
      expect(await addTask(head, { ...vacuum, start })).toEqual({
        ok: false,
        error: 'invalid',
        fields: ['start'],
      });
    }
    for (const start of ['2026-10-08', '2027-10-08']) {
      expect(await addTask(head, { ...vacuum, start })).toMatchObject({ ok: true });
    }
  });

  it('names every field that isn’t valid, in the form’s order, and adds nothing', async () => {
    const head = await founded();
    const input = { start: '2020-01-01', frequency: 'often', duration: 0, name: '' };
    expect(await addTask(head, input)).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'duration', 'frequency', 'start'],
    });
    expect(await addTask(head, 'Vacuum')).toEqual({ ok: false, error: 'invalid', fields: [] });
    expect(await stored(head.householdId)).toEqual([]);
  });

  it('is for heads with two factors only (ADR-0001 §2, ADR-0010 §3)', async () => {
    const withoutTwoFactor = await founded(false);
    expect(await addTask(withoutTwoFactor, vacuum)).toEqual({ ok: false, error: 'not-allowed' });
    const head = await founded();
    for (const member of [
      { ...head.member, role: 'adult' as const },
      { ...head.member, role: 'child' as const },
      // A profile without an account never acts for itself (ADR-0018 §4).
      { ...head.member, hasAccount: false },
    ]) {
      expect(await addTask({ ...head, member }, vacuum)).toEqual({
        ok: false,
        error: 'not-allowed',
      });
    }
    expect(await stored(withoutTwoFactor.householdId)).toEqual([]);
    expect(await stored(head.householdId)).toEqual([]);
  });
});
