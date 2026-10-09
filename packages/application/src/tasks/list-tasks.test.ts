import { accounts, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from '../households/create-household';
import { membership } from '../households/membership';
import { settableClock } from '../testing';
import { addTask } from './add-task';
import { listTasks } from './list-tasks';

// The household's tasks, as every member sees them (ADR-0001 §1, ADR-0012 §3), on a real database
// (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

/** A household in `timeZone` and its founding head with two factors, as the guard finds them. */
const founded = async (name = 'Ash Lane', timeZone = 'Europe/Brussels', country = 'BE') => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  await db.insert(passkeys).values({
    userId: account.id,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const result = await createHousehold(
    {
      db,
      actor: { account: account.id, twoFactor: true },
      account: { id: account.id, managed: false, guardians: [] },
    },
    { name, headName: 'Robin', country, timeZone, language: 'en', weekStartDay: 1, adult: true },
  );
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account.id, result.householdId);
  if (!member) throw new Error('Not a member');
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  return { db, clock, householdId: result.householdId, member };
};

const add = async (
  head: Awaited<ReturnType<typeof founded>>,
  name: string,
  frequency: string,
  onMiss = 'roll over',
) => {
  const result = await addTask(head, { name, duration: 20, frequency, onMiss });
  if (!result.ok) throw new Error(`Not added: ${result.error}`);
  return result.taskId;
};

describe('listTasks (ADR-0001 §1)', () => {
  it('lists the household’s tasks by name, with their frequencies and on-miss policies', async () => {
    const head = await founded();
    const water = await add(head, 'Water the plants', 'biweekly', 'lapse');
    const fridge = await add(head, 'Clean the fridge', 'monthly');
    const result = await listTasks(head);
    expect(result).toEqual({
      ok: true,
      household: 'Ash Lane',
      tasks: [
        {
          id: fridge,
          name: 'Clean the fridge',
          duration: 20,
          frequency: 'monthly',
          onMiss: 'roll over',
        },
        {
          id: water,
          name: 'Water the plants',
          duration: 20,
          frequency: 'biweekly',
          onMiss: 'lapse',
        },
      ],
      mayAddTasks: true,
      starts: expect.anything() as unknown,
    });
  });

  it('lists none of another household’s tasks (TEST-4)', async () => {
    const ash = await founded();
    await add(ash, 'Vacuum', 'weekly');
    const birch = await founded('Birch Court');
    expect(await listTasks(birch)).toMatchObject({ household: 'Birch Court', tasks: [] });
  });

  it('shows the tasks to every member with an account, and lets heads with two factors add', async () => {
    const head = await founded();
    await add(head, 'Vacuum', 'weekly');
    const seen = { tasks: [{ name: 'Vacuum', frequency: 'weekly' }] };
    expect(await listTasks(head)).toMatchObject({ ...seen, mayAddTasks: true });
    for (const member of [
      { ...head.member, twoFactor: false },
      { ...head.member, role: 'adult' as const },
      { ...head.member, role: 'child' as const },
    ]) {
      expect(await listTasks({ ...head, member })).toMatchObject({ ...seen, mayAddTasks: false });
    }
  });

  it('is refused to a profile without an account, which never acts for itself (ADR-0018 §4)', async () => {
    const head = await founded();
    const profile = { ...head.member, hasAccount: false };
    expect(await listTasks({ ...head, member: profile })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });

  it('gives the days a new task can start on, from today in the household’s time zone', async () => {
    // 23:30 on 7 October in UTC is 8 October in Brussels, but not yet in the Azores.
    for (const [timeZone, country, earliest, latest] of [
      ['Europe/Brussels', 'BE', '2026-10-08', '2027-10-08'],
      ['Atlantic/Azores', 'PT', '2026-10-07', '2027-10-07'],
    ] as const) {
      const head = await founded('Ash Lane', timeZone, country);
      head.clock.advance({ hours: -8, minutes: -30 });
      const result = await listTasks(head);
      if (!result.ok) throw new Error('Not listed');
      const { starts } = result;
      expect([starts.earliest.toString(), starts.latest.toString()]).toEqual([earliest, latest]);
    }
  });
});
