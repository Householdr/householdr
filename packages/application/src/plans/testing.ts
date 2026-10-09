import {
  absences,
  accounts,
  assignments,
  awayPeriods,
  households,
  inHousehold,
  members,
  occurrences,
  passkeys,
  plans,
  tasks,
  temporaryShares,
  type Database,
} from '@householdr/db';
import { eq } from 'drizzle-orm';
import { createHousehold } from '../households/create-household';
import { membership, type HouseholdContext } from '../households/membership';
import { addTask } from '../tasks/add-task';
import { settableClock } from '../testing';
import type { PlanContext } from './planning';

// A household to plan for, in the plans' tests (TEST-11): invented, as all test data (TEST-8).

let next = 0;

/**
 * A household founded by Robin, a head with two factors, with Alex, an adult with an account. Its
 * weeks start on Mondays in `timeZone`; it is past setup from the week of `started`, unless that
 * is null, having started now if `startedNow`. The clock reads Thursday 8 October 2026, 10:00 in
 * Brussels.
 */
export async function plannedHousehold(
  db: Database,
  {
    timeZone = 'Europe/Brussels',
    country = 'BE',
    started = '2026-10-12',
    startedNow = false,
  }: { timeZone?: string; country?: string; started?: string | null; startedNow?: boolean } = {},
) {
  const account = async (name: string) => {
    const [row] = await db
      .insert(accounts)
      .values({ name, email: `${name}-${String(++next)}@example.org`, culture: 'en-BE' })
      .returning({ id: accounts.id });
    if (!row) throw new Error('No account');
    return row.id;
  };
  const robin = await account('robin');
  await db.insert(passkeys).values({
    userId: robin,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const created = await createHousehold(
    {
      db,
      actor: { account: robin, twoFactor: true },
      account: { id: robin, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country,
      timeZone,
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  const { householdId } = created;
  const alex = await account('alex');
  await inHousehold(db, householdId, async (tx) => {
    await tx.insert(members).values({ householdId, name: 'Alex', role: 'adult', accountId: alex });
    if (started) await tx.update(households).set({ firstPlanWeek: started, startedNow });
  });
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  const as = async (accountId: string): Promise<HouseholdContext> => {
    const member = await membership({ db }, accountId, householdId);
    if (!member) throw new Error('Not a member');
    return { db, clock, householdId, member };
  };
  const head = await as(robin);
  const adult = await as(alex);
  const scheduler: PlanContext = { db, clock, householdId, member: 'scheduler' };
  const inIt = <T>(work: Parameters<typeof inHousehold<T>>[2]) =>
    inHousehold(db, householdId, work);
  return {
    householdId,
    clock,
    head,
    adult,
    scheduler,
    robin: head.member.id,
    alex: adult.member.id,
    inIt,
    /** Adds a task on a simple frequency, by Robin, and returns its id. */
    task: async (
      name: string,
      duration: number,
      frequency: string,
      start: string,
      onMiss = 'roll over',
    ) => {
      const result = await addTask(head, { name, duration, frequency, start, onMiss });
      if (!result.ok) throw new Error(`Not added: ${result.error}`);
      return result.taskId;
    },
    /** Plans an absence for a member, both days included. */
    absent: (memberId: string, firstDay: string, lastDay: string) =>
      inIt((tx) => tx.insert(absences).values({ householdId, memberId, firstDay, lastDay })),
    /** Marks the household away, both days included. */
    away: (firstDay: string, lastDay: string) =>
      inIt((tx) => tx.insert(awayPeriods).values({ householdId, firstDay, lastDay })),
    /** Sets a member's share, in percent. */
    share: (memberId: string, percent: number) =>
      inIt((tx) =>
        tx.update(members).set({ sharePercent: percent }).where(eq(members.id, memberId)),
      ),
    /** Plans a temporary share for a member, both days included. */
    temporaryShare: (memberId: string, firstDay: string, lastDay: string, percent: number) =>
      inIt((tx) =>
        tx.insert(temporaryShares).values({ householdId, memberId, firstDay, lastDay, percent }),
      ),
    /** The plan of the week starting on `weekStart`, and its occurrences, as stored. */
    plan: (weekStart: string) =>
      inIt(async (tx) => {
        const [plan] = await tx.select().from(plans).where(eq(plans.weekStart, weekStart));
        if (!plan) return undefined;
        const rows = await tx
          .select({
            task: tasks.name,
            date: occurrences.date,
            occurrence: occurrences.id,
            status: occurrences.status,
            member: members.name,
            cost: assignments.cost,
            reason: assignments.reason,
            cause: assignments.unassignedCause,
            version: assignments.version,
          })
          .from(assignments)
          .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
          .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
          .leftJoin(members, eq(members.id, assignments.memberId))
          .where(eq(assignments.planId, plan.id))
          .orderBy(occurrences.date, tasks.name);
        return { ...plan, rows };
      }),
    /** Every occurrence of the household, as stored, by date and task. */
    occurrences: () =>
      inIt((tx) =>
        tx
          .select({
            id: occurrences.id,
            task: tasks.name,
            date: occurrences.date,
            status: occurrences.status,
            closedByPlan: occurrences.closedByPlan,
          })
          .from(occurrences)
          .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
          .orderBy(occurrences.date, tasks.name),
      ),
  };
}

export type PlannedHousehold = Awaited<ReturnType<typeof plannedHousehold>>;
