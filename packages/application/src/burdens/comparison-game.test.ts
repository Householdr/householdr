import {
  accounts,
  comparisons,
  inHousehold,
  members,
  passkeys,
  type Database,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHousehold } from '../households/create-household';
import { membership } from '../households/membership';
import { addTask } from '../tasks/add-task';
import { settableClock } from '../testing';
import { answerComparison } from './answer-comparison';
import { comparisonGame } from './comparison-game';

// What the comparison game shows a member: the next pair, and their own burdens (ADR-0003 §3a,
// §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
const newAccount = async (name: string) => {
  const [account] = await db
    .insert(accounts)
    .values({ name, email: `${name}-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  return account.id;
};

/** A household in Brussels and its founding head with two factors, as the guard finds them. */
const founded = async (name = 'Ash Lane') => {
  const account = await newAccount('robin');
  await db.insert(passkeys).values({
    userId: account,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const result = await createHousehold(
    {
      db,
      actor: { account, twoFactor: true },
      account: { id: account, managed: false, guardians: [] },
    },
    {
      name,
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!result.ok) throw new Error(`Not created: ${result.error}`);
  const member = await membership({ db }, account, result.householdId);
  if (!member) throw new Error('Not a member');
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  return { db, clock, householdId: result.householdId, member };
};
type Context = Awaited<ReturnType<typeof founded>>;

/** Another member of `head`'s household, with an account of their own, as the guard finds them. */
const joined = async (head: Context, role: 'adult' | 'child' = 'adult') => {
  const account = await newAccount('sam');
  await inHousehold(db, head.householdId, (tx) =>
    tx.insert(members).values({
      householdId: head.householdId,
      name: 'Sam',
      role,
      birthDate: role === 'child' ? '2014-05-01' : null,
      accountId: account,
    }),
  );
  const member = await membership({ db }, account, head.householdId);
  if (!member) throw new Error('Not a member');
  return { ...head, member };
};

/** Adds weekly tasks, or as often as said, and returns their ids by name. */
const withTasks = async (head: Context, ...tasks: (string | [string, string])[]) => {
  const ids: Record<string, string> = {};
  for (const task of tasks) {
    const [name, frequency] = typeof task === 'string' ? [task, 'weekly'] : task;
    const result = await addTask(head, { name, duration: 20, frequency, onMiss: 'roll over' });
    if (!result.ok) throw new Error(`Not added: ${result.error}`);
    ids[name] = result.taskId;
  }
  return ids;
};

/** Answers that `harder` is harder than `easier`, `times` times. */
const answer = async (context: Context, harder: string, easier: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    const result = await answerComparison(context, { tasks: [harder, easier], harder });
    if (!result.ok) throw new Error(`Not answered: ${result.error}`);
  }
};

const played = async (context: Context, input: unknown = {}) => {
  const result = await comparisonGame(context, input);
  if (!result.ok) throw new Error(`Not played: ${result.error}`);
  return result;
};
const burdenOf = (result: Awaited<ReturnType<typeof played>>, name: string) =>
  result.burdens.find((task) => task.name === name)?.burden;
const answersIn = (householdId: string) =>
  inHousehold(db, householdId, (tx) => tx.select().from(comparisons));

describe('comparisonGame (ADR-0003 §3a)', () => {
  it('asks nothing while the household has fewer than two tasks', async () => {
    const head = await founded();
    expect(await played(head)).toEqual({
      ok: true,
      household: 'Ash Lane',
      pair: null,
      skipped: 0,
      answered: false,
      burdens: [],
    });
    const { Dishes } = await withTasks(head, 'Dishes');
    expect(await played(head)).toMatchObject({
      pair: null,
      burdens: [{ id: Dishes, name: 'Dishes', burden: 1 }],
    });
  });

  it('asks about two of the household’s tasks, by name, each counting 1.0 until answered', async () => {
    const head = await founded();
    const ids = await withTasks(head, 'Dishes', 'Ironing', 'Vacuum');
    const result = await played(head);
    const [first, second] = result.pair ?? [];
    if (!first || !second) throw new Error('No pair');
    expect(first.id).not.toBe(second.id);
    for (const task of [first, second]) expect(ids[task.name]).toBe(task.id);
    expect(result).toMatchObject({ answered: false, skipped: 0 });
    expect(result.burdens.map(({ name, burden }) => [name, burden])).toEqual([
      ['Dishes', 1],
      ['Ironing', 1],
      ['Vacuum', 1],
    ]);
  });

  it('asks another pair after each skip, until every pair was asked, and records nothing', async () => {
    const head = await founded();
    await withTasks(head, 'Dishes', 'Ironing', 'Vacuum');
    const names = async (skipped: number) =>
      (await played(head, { skipped })).pair?.map((task) => task.name).join(' / ');
    const asked = [await names(0), await names(1), await names(2)];
    expect(new Set(asked).size).toBe(3);
    expect(await names(3)).toBe(asked[0]);
    expect(await answersIn(head.householdId)).toEqual([]);
  });

  it('refuses a number of skips that isn’t a whole number from 0', async () => {
    const head = await founded();
    for (const skipped of [-1, 1.5, Number.NaN, '2']) {
      expect(await comparisonGame(head, { skipped })).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('makes a task count for more after a few answers that it is harder (ADR-0003 §4)', async () => {
    const head = await founded();
    const { Dishes, Ironing } = await withTasks(head, 'Dishes', 'Ironing', 'Vacuum');
    await answer(head, Ironing ?? '', Dishes ?? '', 3);
    const result = await played(head);
    expect(result.answered).toBe(true);
    expect(result.burdens.map((task) => task.name)).toEqual(['Ironing', 'Vacuum', 'Dishes']);
    expect(burdenOf(result, 'Ironing')).toBeGreaterThan(1);
    expect(burdenOf(result, 'Dishes')).toBeLessThan(1);
    // The answers settled ironing against dishes, so vacuuming comes up next.
    expect(result.pair?.map((task) => task.name)).toContain('Vacuum');
  });

  it('weighs tasks by how often they occur, so the member’s mean stays 1.0 (ADR-0003 §1)', async () => {
    const head = await founded();
    const { Dishes, Ironing } = await withTasks(
      head,
      ['Dishes', 'daily'],
      ['Ironing', 'weekly'],
      ['Windows', 'yearly'],
    );
    await answer(head, Ironing ?? '', Dishes ?? '', 2);
    const result = await played(head);
    // From Thursday 8 October 2026 to 7 October 2027: 365 days, 53 Thursdays and one 8 October.
    const often: Record<string, number> = { Dishes: 365, Ironing: 53, Windows: 1 };
    const total = result.burdens.reduce((sum, t) => sum + (often[t.name] ?? 0) * t.burden, 0);
    expect(total / (365 + 53 + 1)).toBeCloseTo(1, 9);
  });

  it('lets every member with an account play for themselves', async () => {
    const head = await founded();
    await withTasks(head, 'Dishes', 'Ironing');
    for (const member of [
      head.member,
      { ...head.member, twoFactor: false },
      (await joined(head)).member,
      (await joined(head, 'child')).member,
    ]) {
      expect(await played({ ...head, member })).toMatchObject({ pair: [{}, {}] });
    }
  });

  it('is refused to a profile without an account, which never acts for itself (ADR-0018 §4)', async () => {
    const head = await founded();
    const profile = { ...head.member, hasAccount: false };
    expect(await comparisonGame({ ...head, member: profile }, {})).toEqual({
      ok: false,
      error: 'not-allowed',
    });
  });
});

describe('a member’s answers are theirs alone (ADR-0003 §5, ADR-0018 §4)', () => {
  it('never shape another member’s burdens or pairs, heads’ included', async () => {
    const head = await founded();
    const { Dishes, Ironing } = await withTasks(head, 'Dishes', 'Ironing', 'Vacuum');
    const adult = await joined(head);
    const before = await played(head);
    await answer(adult, Ironing ?? '', Dishes ?? '', 3);

    // The head sees what they saw before, as if the adult had answered nothing.
    expect(await played(head)).toEqual(before);
    expect(burdenOf(await played(adult), 'Ironing')).toBeGreaterThan(1);

    // And the other way round.
    await answer(head, Dishes ?? '', Ironing ?? '', 3);
    const adults = await played(adult);
    expect(burdenOf(adults, 'Ironing')).toBeGreaterThan(burdenOf(adults, 'Dishes') ?? 0);
    const heads = await played(head);
    expect(burdenOf(heads, 'Dishes')).toBeGreaterThan(burdenOf(heads, 'Ironing') ?? 0);
  });

  it('are nothing to another household (TEST-4)', async () => {
    const ash = await founded();
    const { Dishes, Ironing } = await withTasks(ash, 'Dishes', 'Ironing');
    await answer(ash, Ironing ?? '', Dishes ?? '', 3);
    const birch = await founded('Birch Court');
    expect(await played(birch)).toEqual({
      ok: true,
      household: 'Birch Court',
      pair: null,
      skipped: 0,
      answered: false,
      burdens: [],
    });
  });
});
