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

// Recording an answer of the comparison game (ADR-0003 §3a), on a real database (TEST-11).

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

/**
 * A household in Brussels, its founding head with two factors, as the guard finds them, and its
 * tasks Dishes and Ironing.
 */
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
  const context = { db, clock, householdId: result.householdId, member };
  const task = async (taskName: string) => {
    const added = await addTask(context, {
      name: taskName,
      duration: 20,
      frequency: 'weekly',
      onMiss: 'roll over',
    });
    if (!added.ok) throw new Error(`Not added: ${added.error}`);
    return added.taskId;
  };
  return { ...context, dishes: await task('Dishes'), ironing: await task('Ironing') };
};
type Household = Awaited<ReturnType<typeof founded>>;

/** Another adult of `head`'s household, with an account of their own, as the guard finds them. */
const joined = async (head: Household) => {
  const account = await newAccount('sam');
  await inHousehold(db, head.householdId, (tx) =>
    tx
      .insert(members)
      .values({ householdId: head.householdId, name: 'Sam', role: 'adult', accountId: account }),
  );
  const member = await membership({ db }, account, head.householdId);
  if (!member) throw new Error('Not a member');
  return { ...head, member };
};

const answersIn = (householdId: string) =>
  inHousehold(db, householdId, (tx) =>
    tx
      .select({
        memberId: comparisons.memberId,
        harderTaskId: comparisons.harderTaskId,
        easierTaskId: comparisons.easierTaskId,
        answeredAt: comparisons.answeredAt,
      })
      .from(comparisons)
      .orderBy(comparisons.answeredAt),
  );

describe('answerComparison (ADR-0003 §3a)', () => {
  it('records which task is harder for the member, and when they said so', async () => {
    const head = await founded();
    const { dishes, ironing } = head;
    expect(await answerComparison(head, { tasks: [dishes, ironing], harder: ironing })).toEqual({
      ok: true,
      harder: 'Ironing',
      easier: 'Dishes',
    });
    expect(await answersIn(head.householdId)).toEqual([
      {
        memberId: head.member.id,
        harderTaskId: ironing,
        easierTaskId: dishes,
        answeredAt: new Date('2026-10-08T08:00:00Z'),
      },
    ]);
  });

  it('records one answer each time, the first task or the second', async () => {
    const head = await founded();
    const { dishes, ironing } = head;
    await answerComparison(head, { tasks: [ironing, dishes], harder: ironing });
    head.clock.advance({ minutes: 1 });
    await answerComparison(head, { tasks: [ironing, dishes], harder: dishes });
    expect(await answersIn(head.householdId)).toEqual([
      expect.objectContaining({ harderTaskId: ironing, easierTaskId: dishes }),
      expect.objectContaining({
        harderTaskId: dishes,
        easierTaskId: ironing,
        answeredAt: new Date('2026-10-08T08:01:00Z'),
      }),
    ]);
  });

  it('records for the member answering, whoever else the answer names', async () => {
    const head = await founded();
    const adult = await joined(head);
    const { dishes, ironing } = head;
    for (const input of [
      { tasks: [dishes, ironing], harder: ironing, member: head.member.id },
      { tasks: [dishes, ironing], harder: ironing, memberId: head.member.id },
    ]) {
      expect(await answerComparison(adult, input)).toMatchObject({ ok: true });
    }
    const recorded = await answersIn(head.householdId);
    expect(recorded.map((row) => row.memberId)).toEqual([adult.member.id, adult.member.id]);
  });

  it('takes two different tasks of the household, one of them harder, or records nothing', async () => {
    const head = await founded();
    const { dishes, ironing } = head;
    for (const input of [
      { tasks: [ironing, ironing], harder: ironing },
      { tasks: [ironing, ironing.toUpperCase()], harder: ironing },
      { tasks: [dishes, ironing] },
      { tasks: [dishes, ironing], harder: crypto.randomUUID() },
      { tasks: [dishes], harder: dishes },
      { tasks: [dishes, ironing, crypto.randomUUID()], harder: dishes },
      { tasks: [dishes, 'ironing'], harder: dishes },
      { tasks: [dishes, crypto.randomUUID()], harder: dishes },
      {},
      null,
    ]) {
      expect(await answerComparison(head, input)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await answersIn(head.householdId)).toEqual([]);
  });

  it('refuses a task of another household (TEST-4)', async () => {
    const ash = await founded();
    const birch = await founded('Birch Court');
    for (const input of [
      { tasks: [ash.dishes, birch.ironing], harder: birch.ironing },
      { tasks: [ash.dishes, birch.ironing], harder: ash.dishes },
      { tasks: [birch.dishes, birch.ironing], harder: birch.ironing },
    ]) {
      expect(await answerComparison(ash, input)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await answersIn(ash.householdId)).toEqual([]);
    expect(await answersIn(birch.householdId)).toEqual([]);
  });

  it('lets every member with an account answer for themselves', async () => {
    const head = await founded();
    const { dishes, ironing } = head;
    const adult = await joined(head);
    for (const context of [
      head,
      { ...head, member: { ...head.member, twoFactor: false } },
      adult,
    ]) {
      expect(
        await answerComparison(context, { tasks: [dishes, ironing], harder: dishes }),
      ).toMatchObject({ ok: true });
    }
    expect(await answersIn(head.householdId)).toHaveLength(3);
  });

  it('is refused to a profile without an account, which never acts for itself (ADR-0018 §4)', async () => {
    const head = await founded();
    const { dishes, ironing } = head;
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await answerComparison(profile, { tasks: [dishes, ironing], harder: dishes })).toEqual({
      ok: false,
      error: 'not-allowed',
    });
    expect(await answersIn(head.householdId)).toEqual([]);
  });
});
