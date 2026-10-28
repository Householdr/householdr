import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { connect, inHousehold, refuseBypass, type Database } from './connection';
import { accounts } from './auth-schema';
import {
  absences,
  areas,
  assignments,
  comparisons,
  completionCredits,
  completions,
  households,
  members,
  occurrences,
  parentalConsents,
  plans,
  profileGuardians,
  schedules,
  taskConstraints,
  tasks,
} from './schema';
import { refusal, refusedByRowSecurity, testDatabase, testServerUrl } from './testing';

// Row-level security keeps every household to its own rows (ADR-0008 §9, CODE-17), as a role
// without superuser rights, the way the app connects.

let db: Database;
let owner: Database;
let close: () => Promise<void>;
const ash = '00000000-0000-4000-8000-00000000000a';
const birch = '00000000-0000-4000-8000-00000000000b';
const household = (id: string, name: string) => ({
  id,
  name,
  country: 'BE',
  language: 'nl',
  timeZone: 'Europe/Brussels',
  weekStartDay: 1 as const,
});

beforeAll(async () => {
  ({ db, owner, close } = await testDatabase());
  for (const [id, name, head] of [
    [ash, 'Ash Lane', 'Robin'],
    [birch, 'Birch Court', 'Sam'],
  ] as const) {
    await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id, name));
      await tx.insert(members).values({ householdId: id, name: head, role: 'head' });
    });
  }
});
afterAll(() => close());

describe('inHousehold (ADR-0008 §9)', () => {
  it('sees only its own household and members', async () => {
    const seen = await inHousehold(db, ash, async (tx) => ({
      households: await tx.select({ name: households.name }).from(households),
      members: await tx.select({ name: members.name }).from(members),
    }));
    expect(seen).toEqual({ households: [{ name: 'Ash Lane' }], members: [{ name: 'Robin' }] });
  });

  it('cannot add a member to another household', async () => {
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(members).values({ householdId: birch, name: 'Alex', role: 'adult' }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot move a member to another household, or change one it cannot see', async () => {
    expect(
      await refusal(inHousehold(db, ash, (tx) => tx.update(members).set({ householdId: birch }))),
    ).toBe(refusedByRowSecurity);
    const renamed = await inHousehold(db, ash, (tx) =>
      tx.update(members).set({ name: 'Taken' }).where(eq(members.name, 'Sam')).returning(),
    );
    expect(renamed).toEqual([]);
  });

  it('cannot delete another household', async () => {
    const deleted = await inHousehold(db, ash, (tx) =>
      tx.delete(households).where(eq(households.id, birch)).returning(),
    );
    expect(deleted).toEqual([]);
  });

  it('ends with its transaction: outside it, nothing is seen or written', async () => {
    await inHousehold(db, ash, (tx) => tx.select().from(members));
    expect(await db.select().from(members)).toEqual([]);
    expect(await db.select().from(households)).toEqual([]);
    expect(
      await refusal(db.insert(members).values({ householdId: ash, name: 'Alex', role: 'adult' })),
    ).toBe(refusedByRowSecurity);
  });

  it('rolls back what it wrote when its work fails', async () => {
    await expect(
      inHousehold(db, ash, async (tx) => {
        await tx.insert(members).values({ householdId: ash, name: 'Alex', role: 'adult' });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const names = await inHousehold(db, ash, (tx) =>
      tx.select({ name: members.name }).from(members),
    );
    expect(names).toEqual([{ name: 'Robin' }]);
  });

  it('refuses an id that is not a household id', async () => {
    await expect(
      inHousehold(db, "x' or 1=1 --", (tx) => tx.select().from(members)),
    ).rejects.toThrow(RangeError);
  });
});

describe('schedules and tasks (ADR-0008 §9, CODE-17)', () => {
  const weekly = { rrule: 'FREQ=WEEKLY', start: '2026-10-08' };
  /** A weekly schedule and a task on it in household `id`, read as that household. */
  const addTask = (id: string, name: string) =>
    inHousehold(db, id, async (tx) => {
      const [schedule] = await tx
        .insert(schedules)
        .values({ householdId: id, rules: [weekly] })
        .returning({ id: schedules.id });
      if (!schedule) throw new Error('No schedule');
      await tx.insert(tasks).values({
        householdId: id,
        name,
        duration: 30,
        scheduleId: schedule.id,
        timing: 'flexible',
        onMiss: 'roll over',
      });
      return schedule.id;
    });
  let birchSchedule: string;
  beforeAll(async () => {
    await addTask(ash, 'Vacuum');
    birchSchedule = await addTask(birch, 'Water the plants');
  });

  it('sees only its own', async () => {
    const seen = await inHousehold(db, ash, async (tx) => ({
      tasks: await tx.select({ name: tasks.name }).from(tasks),
      schedules: await tx.select({ id: schedules.id }).from(schedules),
    }));
    expect(seen.tasks).toEqual([{ name: 'Vacuum' }]);
    expect(seen.schedules).toHaveLength(1);
    expect(seen.schedules).not.toContainEqual({ id: birchSchedule });
  });

  it('cannot add one to another household', async () => {
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(schedules).values({ householdId: birch, rules: [weekly] }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(tasks).values({
            householdId: birch,
            name: 'Taken',
            duration: 30,
            scheduleId: birchSchedule,
            timing: 'flexible',
            onMiss: 'roll over',
          }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot put a task on another household’s schedule', async () => {
    // Foreign keys are checked past row-level security, so the key includes the household.
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(tasks).values({
            householdId: ash,
            name: 'Borrowed',
            duration: 30,
            scheduleId: birchSchedule,
            timing: 'flexible',
            onMiss: 'roll over',
          }),
        ),
      ),
    ).toBe('tasks_schedule');
  });

  it('cannot change or delete another household’s', async () => {
    const changed = await inHousehold(db, ash, async (tx) => ({
      tasks: await tx
        .update(tasks)
        .set({ name: 'Taken' })
        .where(eq(tasks.name, 'Water the plants'))
        .returning(),
      schedules: await tx.delete(schedules).where(eq(schedules.id, birchSchedule)).returning(),
    }));
    expect(changed).toEqual({ tasks: [], schedules: [] });
  });
});

describe('plans, occurrences and assignments (ADR-0008 §9, CODE-17)', () => {
  const week = { weekStart: '2026-10-12', weekEnd: '2026-10-19' };
  const window = {
    windowStart: new Date('2026-10-11T22:00:00Z'),
    windowEnd: new Date('2026-10-18T22:00:00Z'),
  };
  /** A household's head, task, plan and occurrence, read as that household. */
  const planned = (id: string) =>
    inHousehold(db, id, async (tx) => {
      const [member] = await tx.select({ id: members.id }).from(members);
      const [task] = await tx.select({ id: tasks.id }).from(tasks);
      if (!member || !task) throw new Error('No member or task');
      const [plan] = await tx
        .insert(plans)
        .values({ householdId: id, ...week, status: 'draft', draftedAt: new Date() })
        .returning({ id: plans.id });
      const [occurrence] = await tx
        .insert(occurrences)
        .values({ householdId: id, taskId: task.id, date: '2026-10-14', ...window })
        .returning({ id: occurrences.id });
      if (!plan || !occurrence) throw new Error('No plan or occurrence');
      await tx.insert(assignments).values({
        householdId: id,
        planId: plan.id,
        occurrenceId: occurrence.id,
        ...window,
        memberId: member.id,
        cost: 30,
        reason: 'lowest relative load',
      });
      return { member: member.id, task: task.id, plan: plan.id, occurrence: occurrence.id };
    });
  let ashPlan: Awaited<ReturnType<typeof planned>>;
  let birchPlan: Awaited<ReturnType<typeof planned>>;
  beforeAll(async () => {
    ashPlan = await planned(ash);
    birchPlan = await planned(birch);
  });

  it('are seen in their own household only', async () => {
    const seen = (id: string) =>
      inHousehold(db, id, async (tx) => ({
        plans: await tx.select({ id: plans.id }).from(plans),
        occurrences: await tx.select({ id: occurrences.id }).from(occurrences),
        assignments: await tx.select({ member: assignments.memberId }).from(assignments),
      }));
    expect(await seen(ash)).toEqual({
      plans: [{ id: ashPlan.plan }],
      occurrences: [{ id: ashPlan.occurrence }],
      assignments: [{ member: ashPlan.member }],
    });
    expect(await db.select().from(assignments)).toEqual([]);
  });

  it('cannot be added to another household', async () => {
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(plans).values({
            householdId: birch,
            weekStart: '2026-10-19',
            weekEnd: '2026-10-26',
            status: 'draft',
            draftedAt: new Date(),
          }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('never refer to another household’s task, plan, occurrence or member', async () => {
    // Foreign keys are checked past row-level security, so each key includes the household.
    const own = { householdId: ash, ...window };
    const [other] = await inHousehold(db, ash, (tx) =>
      tx
        .insert(occurrences)
        .values({ ...own, taskId: ashPlan.task, date: '2026-10-16' })
        .returning({ id: occurrences.id }),
    );
    if (!other) throw new Error('No occurrence');
    const unplanned = { ...ashPlan, occurrence: other.id };
    for (const [constraint, values] of [
      ['assignments_member', { ...unplanned, member: birchPlan.member }],
      ['assignments_occurrence', { ...ashPlan, occurrence: birchPlan.occurrence }],
      ['assignments_plan', { ...unplanned, plan: birchPlan.plan }],
    ] as const) {
      expect(
        await refusal(
          inHousehold(db, ash, (tx) =>
            tx.insert(assignments).values({
              ...own,
              planId: values.plan,
              occurrenceId: values.occurrence,
              memberId: values.member,
              cost: 30,
              reason: 'lowest relative load',
            }),
          ),
        ),
      ).toBe(constraint);
    }
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(occurrences).values({ ...own, taskId: birchPlan.task, date: '2026-10-15' }),
        ),
      ),
    ).toBe('occurrences_task');
  });

  it('cannot be changed or deleted by another household', async () => {
    const changed = await inHousehold(db, ash, async (tx) => ({
      plans: await tx
        .update(plans)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(plans.id, birchPlan.plan))
        .returning(),
      assignments: await tx
        .delete(assignments)
        .where(eq(assignments.memberId, birchPlan.member))
        .returning(),
    }));
    expect(changed).toEqual({ plans: [], assignments: [] });
  });

  describe('completions and their credits (ADR-0006 §4)', () => {
    /** Completes household `id`'s occurrence for its head, at 30 points, as that household. */
    const complete = (id: string, own: typeof ashPlan) =>
      inHousehold(db, id, async (tx) => {
        const [completion] = await tx
          .insert(completions)
          .values({
            householdId: id,
            occurrenceId: own.occurrence,
            planId: own.plan,
            loggedBy: own.member,
            at: new Date('2026-10-14T17:00:00Z'),
          })
          .returning({ id: completions.id });
        if (!completion) throw new Error('No completion');
        await tx.insert(completionCredits).values({
          householdId: id,
          completionId: completion.id,
          memberId: own.member,
          points: 30,
        });
        return completion.id;
      });
    let birchCompletion: string;
    beforeAll(async () => {
      await complete(ash, ashPlan);
      birchCompletion = await complete(birch, birchPlan);
    });

    it('are seen in their own household only', async () => {
      const seen = (id: string) =>
        inHousehold(db, id, async (tx) => ({
          completions: await tx.select({ loggedBy: completions.loggedBy }).from(completions),
          credits: await tx.select({ member: completionCredits.memberId }).from(completionCredits),
        }));
      expect(await seen(ash)).toEqual({
        completions: [{ loggedBy: ashPlan.member }],
        credits: [{ member: ashPlan.member }],
      });
      expect(await db.select().from(completions)).toEqual([]);
      expect(await db.select().from(completionCredits)).toEqual([]);
    });

    it('never refer to another household’s occurrence, plan, member or completion', async () => {
      // An occurrence not done yet, so only the key each breaks refuses it.
      const [open] = await inHousehold(db, ash, (tx) =>
        tx
          .insert(occurrences)
          .values({ householdId: ash, taskId: ashPlan.task, date: '2026-10-17', ...window })
          .returning({ id: occurrences.id }),
      );
      if (!open) throw new Error('No occurrence');
      const own = { ...ashPlan, occurrence: open.id };
      for (const [constraint, row] of [
        ['completions_occurrence', { ...own, occurrence: birchPlan.occurrence }],
        ['completions_plan', { ...own, plan: birchPlan.plan }],
        ['completions_logged_by', { ...own, member: birchPlan.member }],
      ] as const) {
        expect(
          await refusal(
            inHousehold(db, ash, (tx) =>
              tx.insert(completions).values({
                householdId: ash,
                occurrenceId: row.occurrence,
                planId: row.plan,
                loggedBy: row.member,
                at: new Date(),
              }),
            ),
          ),
        ).toBe(constraint);
      }
      expect(
        await refusal(
          inHousehold(db, ash, (tx) =>
            tx.insert(completionCredits).values({
              householdId: ash,
              completionId: birchCompletion,
              memberId: ashPlan.member,
              points: 30,
            }),
          ),
        ),
      ).toBe('completion_credits_completion');
    });

    it('cannot be added to, changed in or deleted from another household', async () => {
      expect(
        await refusal(
          inHousehold(db, ash, (tx) =>
            tx.insert(completions).values({
              householdId: birch,
              occurrenceId: birchPlan.occurrence,
              planId: birchPlan.plan,
              loggedBy: birchPlan.member,
              at: new Date(),
            }),
          ),
        ),
      ).toBe(refusedByRowSecurity);
      const changed = await inHousehold(db, ash, async (tx) => ({
        completions: await tx
          .delete(completions)
          .where(eq(completions.id, birchCompletion))
          .returning(),
        credits: await tx
          .update(completionCredits)
          .set({ points: 0 })
          .where(eq(completionCredits.completionId, birchCompletion))
          .returning(),
      }));
      expect(changed).toEqual({ completions: [], credits: [] });
    });

    it('keep an occurrence done once, and go with their credits when undone', async () => {
      expect(await refusal(complete(ash, ashPlan))).toBe('completions_once');
      await inHousehold(db, ash, (tx) => tx.delete(completions));
      const left = await inHousehold(db, ash, (tx) => tx.select().from(completionCredits));
      expect(left).toEqual([]);
    });
  });
});

describe('comparisons (ADR-0008 §9, CODE-17)', () => {
  /** Ash's and Birch's heads, and two tasks of each, as each household sees them. */
  const own = (id: string) =>
    inHousehold(db, id, async (tx) => ({
      member: (await tx.select({ id: members.id }).from(members))[0]?.id ?? '',
      tasks: (await tx.select({ id: tasks.id }).from(tasks).orderBy(tasks.name)).map((t) => t.id),
    }));
  let ashes: Awaited<ReturnType<typeof own>>;
  let birches: Awaited<ReturnType<typeof own>>;
  const answeredAt = new Date('2026-10-08T08:00:00Z');
  /** An answer in household `id`, with the given member and tasks. */
  const answer = (
    id: string,
    member: string,
    [harder = '', easier = '']: readonly (string | undefined)[],
  ) =>
    inHousehold(db, id, (tx) =>
      tx
        .insert(comparisons)
        .values({
          householdId: id,
          memberId: member,
          harderTaskId: harder,
          easierTaskId: easier,
          answeredAt,
        })
        .returning({ id: comparisons.id }),
    );
  beforeAll(async () => {
    for (const [id, names] of [
      [ash, ['Dishes', 'Ironing']],
      [birch, ['Mow the lawn', 'Windows']],
    ] as const) {
      await inHousehold(db, id, async (tx) => {
        const [schedule] = await tx
          .insert(schedules)
          .values({ householdId: id, rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-08' }] })
          .returning({ id: schedules.id });
        if (!schedule) throw new Error('No schedule');
        for (const name of names) {
          await tx.insert(tasks).values({
            householdId: id,
            name,
            duration: 30,
            scheduleId: schedule.id,
            timing: 'flexible',
            onMiss: 'roll over',
          });
        }
      });
    }
    ashes = await own(ash);
    birches = await own(birch);
    await answer(ash, ashes.member, [ashes.tasks[1], ashes.tasks[0]]);
    await answer(birch, birches.member, birches.tasks);
  });

  it('sees only its own', async () => {
    const seen = await inHousehold(db, ash, (tx) =>
      tx.select({ memberId: comparisons.memberId }).from(comparisons),
    );
    expect(seen).toEqual([{ memberId: ashes.member }]);
  });

  it('cannot add one to another household', async () => {
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(comparisons).values({
            householdId: birch,
            memberId: birches.member,
            harderTaskId: birches.tasks[0] ?? '',
            easierTaskId: birches.tasks[1] ?? '',
            answeredAt,
          }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot be about another household’s member or tasks', async () => {
    // Foreign keys are checked past row-level security, so each key includes the household.
    expect(await refusal(answer(ash, birches.member, ashes.tasks))).toBe('comparisons_member');
    expect(await refusal(answer(ash, ashes.member, [birches.tasks[0], ashes.tasks[0]]))).toBe(
      'comparisons_harder_task',
    );
    expect(await refusal(answer(ash, ashes.member, [ashes.tasks[0], birches.tasks[0]]))).toBe(
      'comparisons_easier_task',
    );
  });

  it('cannot change or delete another household’s', async () => {
    const changed = await inHousehold(db, ash, async (tx) => ({
      updated: await tx
        .update(comparisons)
        .set({ answeredAt: new Date('2026-10-09T08:00:00Z') })
        .where(eq(comparisons.memberId, birches.member))
        .returning(),
      deleted: await tx
        .delete(comparisons)
        .where(eq(comparisons.memberId, birches.member))
        .returning(),
    }));
    expect(changed).toEqual({ updated: [], deleted: [] });
    const theirs = await inHousehold(db, birch, (tx) =>
      tx.select({ memberId: comparisons.memberId }).from(comparisons),
    );
    expect(theirs).toEqual([{ memberId: birches.member }]);
  });
});

describe('absences (ADR-0005 §2, ADR-0018 §3)', () => {
  /** The id of the head of household `id`, as that household sees it. */
  const headOf = async (id: string) => {
    const [head] = await inHousehold(db, id, (tx) => tx.select({ id: members.id }).from(members));
    if (!head) throw new Error('No head');
    return head.id;
  };
  const days = { firstDay: '2026-10-12', lastDay: '2026-10-16' };

  it('are seen and written in their own household only', async () => {
    const robin = await headOf(ash);
    await inHousehold(db, ash, (tx) =>
      tx.insert(absences).values({ householdId: ash, memberId: robin, ...days }),
    );
    const seen = (id: string) =>
      inHousehold(db, id, (tx) =>
        tx.select({ firstDay: absences.firstDay, lastDay: absences.lastDay }).from(absences),
      );
    expect(await seen(ash)).toEqual([days]);
    expect(await seen(birch)).toEqual([]);
    expect(await db.select().from(absences)).toEqual([]);
  });

  it('cannot be added to another household, or moved there', async () => {
    const sam = await headOf(birch);
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(absences).values({ householdId: birch, memberId: sam, ...days }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
    expect(
      await refusal(inHousehold(db, ash, (tx) => tx.update(absences).set({ householdId: birch }))),
    ).toBe(refusedByRowSecurity);
  });

  it('never belong to another household’s member', async () => {
    // Foreign keys are checked past row-level security, so the key includes the household.
    const sam = await headOf(birch);
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(absences).values({ householdId: ash, memberId: sam, ...days }),
        ),
      ),
    ).toBe('absences_member_household');
  });

  it('cannot be removed by another household', async () => {
    const sam = await headOf(birch);
    await inHousehold(db, birch, (tx) =>
      tx.insert(absences).values({ householdId: birch, memberId: sam, ...days }),
    );
    const removed = await inHousehold(db, ash, (tx) =>
      tx.delete(absences).where(eq(absences.memberId, sam)).returning(),
    );
    expect(removed).toEqual([]);
    const left = await inHousehold(db, birch, (tx) =>
      tx.select({ memberId: absences.memberId }).from(absences),
    );
    expect(left).toEqual([{ memberId: sam }]);
  });
});

describe('task constraints (ADR-0001 §3, clarification)', () => {
  /** The ids of the head of household `id` and of a task it adds, as that household sees them. */
  const headAndTask = async (id: string) =>
    inHousehold(db, id, async (tx) => {
      const [head] = await tx.select({ id: members.id }).from(members);
      const [task] = await tx
        .insert(tasks)
        .values({
          householdId: id,
          name: 'Clean the oven',
          duration: 40,
          everyCount: 6,
          everyUnit: 'weeks',
          start: '2026-10-12',
          timing: 'flexible',
          onMiss: 'roll over',
        })
        .returning({ id: tasks.id });
      if (!head || !task) throw new Error('No head or task');
      return { member: head.id, task: task.id };
    });

  it('are seen in their own household only, and go with their task', async () => {
    const robin = await headAndTask(ash);
    await inHousehold(db, ash, (tx) =>
      tx.insert(taskConstraints).values({
        householdId: ash,
        taskId: robin.task,
        memberId: robin.member,
        constraint: 'bound',
      }),
    );
    const seen = (id: string) =>
      inHousehold(db, id, (tx) =>
        tx.select({ constraint: taskConstraints.constraint }).from(taskConstraints),
      );
    expect(await seen(ash)).toEqual([{ constraint: 'bound' }]);
    expect(await seen(birch)).toEqual([]);
    await inHousehold(db, ash, (tx) => tx.delete(tasks).where(eq(tasks.id, robin.task)));
    expect(await seen(ash)).toEqual([]);
  });

  it('never tie another household’s member or task', async () => {
    const robin = await headAndTask(ash);
    const sam = await headAndTask(birch);
    const tie = (taskId: string, memberId: string) =>
      refusal(
        inHousehold(db, ash, (tx) =>
          tx
            .insert(taskConstraints)
            .values({ householdId: ash, taskId, memberId, constraint: 'excluded' }),
        ),
      );
    expect(await tie(robin.task, sam.member)).toBe('task_constraints_member_household');
    expect(await tie(sam.task, robin.member)).toBe('task_constraints_task_household');
  });
});

describe('areas (ADR-0001 §1, clarification)', () => {
  it('are seen in their own household only, each name once whatever the case', async () => {
    await inHousehold(db, ash, (tx) =>
      tx.insert(areas).values({ householdId: ash, name: 'Kitchen' }),
    );
    const seen = (id: string) =>
      inHousehold(db, id, (tx) => tx.select({ name: areas.name }).from(areas));
    expect(await seen(ash)).toEqual([{ name: 'Kitchen' }]);
    expect(await seen(birch)).toEqual([]);
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(areas).values({ householdId: ash, name: 'kitchen' }),
        ),
      ),
    ).toBe('areas_household_name');
    // Another household may have its own kitchen.
    await inHousehold(db, birch, (tx) =>
      tx.insert(areas).values({ householdId: birch, name: 'Kitchen' }),
    );
    expect(await seen(birch)).toEqual([{ name: 'Kitchen' }]);
  });

  it('never hold another household’s task', async () => {
    const [garden] = await inHousehold(db, birch, (tx) =>
      tx.insert(areas).values({ householdId: birch, name: 'Garden' }).returning({ id: areas.id }),
    );
    if (!garden) throw new Error('No area');
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(tasks).values({
            householdId: ash,
            name: 'Mow the lawn',
            duration: 40,
            everyCount: 2,
            everyUnit: 'weeks',
            start: '2026-10-12',
            timing: 'flexible',
            onMiss: 'roll over',
            areaId: garden.id,
          }),
        ),
      ),
    ).toBe('tasks_area');
  });
});

describe('connect (ADR-0008 §9)', () => {
  it('refuses a superuser, whom row-level security does not bind', async () => {
    await expect(connect(testServerUrl())).rejects.toThrow('bypasses row-level security');
  });

  it('refuses the owner of the tables, whom row-level security does not bind', async () => {
    await expect(refuseBypass(owner.$client)).rejects.toThrow('householdr_test owns the tables');
  });

  // The server's own superuser also has BYPASSRLS, so each attribute gets a role of its own.
  it.each([
    ['a superuser without BYPASSRLS', 'householdr_test_superuser', 'superuser nobypassrls'],
    ['a role with BYPASSRLS', 'householdr_test_bypass', 'nosuperuser bypassrls'],
  ])('refuses %s', async (_, role, attributes) => {
    const admin = new pg.Client({ connectionString: testServerUrl() });
    await admin.connect();
    try {
      await admin.query(`drop role if exists ${role}`);
      await admin.query(`create role ${role} nologin ${attributes}`);
      const pool = new pg.Pool({ connectionString: testServerUrl(), options: `-c role=${role}` });
      try {
        await expect(refuseBypass(pool)).rejects.toThrow(`${role} bypasses`);
      } finally {
        await pool.end();
      }
    } finally {
      await admin.query(`drop role if exists ${role}`);
      await admin.end();
    }
  });
});

describe('every household-owned table (CODE-17)', () => {
  it('has a household id, row-level security and a policy', async () => {
    const { rows } = await db.execute<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
      scoped: boolean;
    }>(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
        c.relname = 'households' or exists (
          select from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
        ) as scoped
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`);
    expect(rows.map((r) => r.table)).toEqual([
      'absences',
      'activity_log',
      'areas',
      'assignments',
      'away_periods',
      'comparisons',
      'completion_credits',
      'completions',
      'households',
      'invitations',
      'ledger_entries',
      'members',
      'notifications',
      'occurrences',
      'parental_consents',
      'plans',
      'profile_guardians',
      'schedules',
      'share_changes',
      'swaps',
      'task_constraints',
      'tasks',
      'temporary_shares',
    ]);
    for (const row of rows) {
      // Not forced: it binds the app's role, not the owner (ADR-0008 §9, clarification).
      expect(row).toEqual({
        table: row.table,
        enabled: true,
        forced: false,
        policies: 1,
        scoped: true,
      });
    }
  });
});

describe('the two roles (ADR-0008 §9, clarification)', () => {
  it('leave the owner, which runs the migrations, unbound by row-level security', async () => {
    const names = await owner.select({ name: members.name }).from(members).orderBy(members.name);
    expect(names).toEqual([{ name: 'Robin' }, { name: 'Sam' }]);
  });

  it('let the app read and write data, but never change the schema', async () => {
    for (const statement of [
      sql`create table extra (id uuid)`,
      sql`alter table members add column extra text`,
      sql`alter table members disable row level security`,
      sql`drop table auth.rate_limits`,
    ]) {
      // PostgreSQL's code for a missing privilege: here, owning the table or schema.
      expect(await refusal(db.execute(statement))).toBe('42501');
    }
  });
});

describe('tables outside a household (ADR-0008 §9, clarification)', () => {
  it('are the account tables, rate-limit counts, account e-mails, two factors, notification preferences, push subscriptions, sent pushes and unsubscribe tokens in auth, and no others', async () => {
    // `drizzle` holds the list of migrations that have run, and `pgboss` the job queue, whose jobs
    // carry IDs only (ADR-0014 §7, clarification) and whose tables change with pg-boss itself.
    const { rows } = await db.execute<{ name: string }>(sql`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('public', 'drizzle', 'pgboss', 'pg_catalog', 'information_schema')
        and n.nspname not like 'pg_toast%'
      order by name`);
    expect(rows.map((r) => r.name)).toEqual([
      'auth.account_emails',
      'auth.accounts',
      'auth.credentials',
      'auth.notification_preferences',
      'auth.passkeys',
      'auth.push_subscriptions',
      'auth.rate_limits',
      'auth.sent_pushes',
      'auth.sessions',
      'auth.two_factors',
      'auth.unsubscribe_tokens',
      'auth.verifications',
    ]);
  });
});

describe('guardians and consents of children’s profiles (ADR-0010 §9, ADR-0008 §9)', () => {
  // Two more households, each with a child whose guardian consented, so the rows above stay as
  // they are.
  const cedar = '00000000-0000-4000-8000-00000000000c';
  const dogwood = '00000000-0000-4000-8000-00000000000d';
  const children = new Map<string, { memberId: string; accountId: string }>();
  const theirs = (id: string) => {
    const child = children.get(id);
    if (!child) throw new Error('No child');
    return child;
  };
  const consent = (householdId: string, { memberId, accountId }: ReturnType<typeof theirs>) => ({
    householdId,
    memberId,
    givenBy: accountId,
    givenAt: new Date('2026-10-08T08:00:00Z'),
    text: 'I have parental responsibility for this child, and I agree to them using Householdr.',
    language: 'en',
  });

  beforeAll(async () => {
    for (const [id, name] of [
      [cedar, 'Cedar Row'],
      [dogwood, 'Dogwood Way'],
    ] as const) {
      const [account] = await db
        .insert(accounts)
        .values({ name: 'Robin', email: `robin-${id}@example.org`, culture: 'en-BE' })
        .returning({ id: accounts.id });
      if (!account) throw new Error('No account');
      const memberId = await inHousehold(db, id, async (tx) => {
        await tx.insert(households).values(household(id, name));
        const [child] = await tx
          .insert(members)
          .values({ householdId: id, name: 'Kim', role: 'child', birthDate: '2016-03-01' })
          .returning({ id: members.id });
        if (!child) throw new Error('No child');
        return child.id;
      });
      children.set(id, { memberId, accountId: account.id });
      await inHousehold(db, id, async (tx) => {
        await tx
          .insert(profileGuardians)
          .values({ householdId: id, memberId, accountId: account.id });
        await tx.insert(parentalConsents).values(consent(id, theirs(id)));
      });
    }
  });

  it('are seen only in their own household', async () => {
    const seen = await inHousehold(db, cedar, async (tx) => ({
      guardians: await tx.select({ memberId: profileGuardians.memberId }).from(profileGuardians),
      consents: await tx.select({ memberId: parentalConsents.memberId }).from(parentalConsents),
    }));
    const { memberId } = theirs(cedar);
    expect(seen).toEqual({ guardians: [{ memberId }], consents: [{ memberId }] });
  });

  it('cannot be added to another household', async () => {
    const other = theirs(dogwood);
    const guardian = { householdId: dogwood, ...other };
    expect(
      await refusal(inHousehold(db, cedar, (tx) => tx.insert(profileGuardians).values(guardian))),
    ).toBe(refusedByRowSecurity);
    expect(
      await refusal(
        inHousehold(db, cedar, (tx) => tx.insert(parentalConsents).values(consent(dogwood, other))),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot be changed, moved or deleted from another household', async () => {
    const { memberId } = theirs(dogwood);
    const touched = await inHousehold(db, cedar, async (tx) => [
      ...(await tx
        .update(parentalConsents)
        .set({ text: 'Changed.' })
        .where(eq(parentalConsents.memberId, memberId))
        .returning()),
      ...(await tx
        .delete(profileGuardians)
        .where(eq(profileGuardians.memberId, memberId))
        .returning()),
    ]);
    expect(touched).toEqual([]);
    expect(
      await refusal(
        inHousehold(db, cedar, (tx) => tx.update(parentalConsents).set({ householdId: dogwood })),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('are nothing outside a household', async () => {
    expect(await db.select().from(profileGuardians)).toEqual([]);
    expect(await db.select().from(parentalConsents)).toEqual([]);
  });
});
