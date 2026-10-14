import { members, taskConstraints, tasks, type Transaction } from '@householdr/db';
import type { Constraint } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';

/** A head's setting for one member of a task (ADR-0001 §3, clarification). */
interface MemberConstraint {
  memberId: string;
  constraint: Constraint;
}

/** Who a task is for, besides when it is: its minimum age and its constraints, by member. */
export interface TaskRules {
  /** In whole years. */
  minimumAge?: number;
  constraints: MemberConstraint[];
}

/** A member of the household, as the task's page offers them a constraint. */
export interface ConstrainedMember {
  id: string;
  name: string;
  /** Whether they have a birth date, so a minimum age is theirs to be allowed below. */
  child: boolean;
}

const constraintChoices: readonly Constraint[] = ['bound', 'excluded', 'allowed'];

/**
 * What the task's page sends about who does it (CODE-12; ADR-0001 §3, clarification): a minimum
 * age in whole years from 1 to 17, or none, and a constraint for some of the household's
 * `memberIds`, each at most once.
 */
export function taskRulesInput(memberIds: ReadonlySet<string>) {
  return v.object({
    minimumAge: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(17))),
    constraints: v.optional(
      v.pipe(
        v.array(v.object({ memberId: v.string(), constraint: v.picklist(constraintChoices) })),
        v.check((list) => list.every(({ memberId }) => memberIds.has(memberId))),
        v.check((list) => new Set(list.map(({ memberId }) => memberId)).size === list.length),
      ),
      [],
    ),
  });
}

/** The household's members, by name, as the task's page offers them a constraint. */
export async function constrainedMembers(tx: Transaction): Promise<ConstrainedMember[]> {
  const rows = await tx
    .select({ id: members.id, name: members.name, birthDate: members.birthDate })
    .from(members);
  return rows
    .map(({ id, name, birthDate }) => ({ id, name, child: birthDate !== null }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The rules of task `taskId`, its constraints by member id. */
export async function rulesOf(
  tx: Transaction,
  taskId: string,
  minimumAge: number | null,
): Promise<TaskRules> {
  const constraints = await tx
    .select({ memberId: taskConstraints.memberId, constraint: taskConstraints.constraint })
    .from(taskConstraints)
    .where(eq(taskConstraints.taskId, taskId));
  return {
    ...(minimumAge !== null && { minimumAge }),
    constraints: constraints.toSorted((a, b) => a.memberId.localeCompare(b.memberId)),
  };
}

/** Whether two tasks' rules are the same. */
export function sameRules(a: TaskRules, b: TaskRules) {
  const key = (rules: TaskRules) =>
    JSON.stringify([
      rules.minimumAge ?? null,
      rules.constraints.map(({ memberId, constraint }) => `${memberId}:${constraint}`).toSorted(),
    ]);
  return key(a) === key(b);
}

/** Writes `rules` for task `taskId` of household `householdId`, in place of those it had. */
export async function writeRules(
  tx: Transaction,
  householdId: string,
  taskId: string,
  rules: TaskRules,
) {
  await tx
    .update(tasks)
    .set({ minimumAge: rules.minimumAge ?? null })
    .where(eq(tasks.id, taskId));
  await tx.delete(taskConstraints).where(eq(taskConstraints.taskId, taskId));
  if (rules.constraints.length > 0) {
    await tx
      .insert(taskConstraints)
      .values(rules.constraints.map((c) => ({ householdId, taskId, ...c })));
  }
}

/**
 * Every task's rules as the allocator takes them (ADR-0001 §7): its minimum age, if any, and its
 * constraints by member id, by task id.
 */
export async function rulesByTask(tx: Transaction) {
  const ages = await tx.select({ id: tasks.id, minimumAge: tasks.minimumAge }).from(tasks);
  const constraints = await tx
    .select({
      taskId: taskConstraints.taskId,
      memberId: taskConstraints.memberId,
      constraint: taskConstraints.constraint,
    })
    .from(taskConstraints);
  const byTask = Map.groupBy(constraints, ({ taskId }) => taskId);
  return new Map(
    ages.map(({ id, minimumAge }) => [
      id,
      {
        ...(minimumAge !== null && { minimumAge }),
        constraints: new Map(
          (byTask.get(id) ?? []).map(({ memberId, constraint }) => [memberId, constraint]),
        ),
      },
    ]),
  );
}
