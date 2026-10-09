import {
  activityLog,
  assignments,
  completionCredits,
  completions,
  inHousehold,
  members,
  occurrences,
  plans,
  tasks,
  type Transaction,
} from '@householdr/db';
import { can, completionCredits as creditsOf, type Member } from '@householdr/domain';
import { and, eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/context';
import { creditedMembers, thisPlanWeek } from './completion-week';

const id = v.pipe(v.string(), v.uuid());

/** What completing sends (CODE-12): the occurrence, and who did it, the acting member by default. */
const completeInput = v.object({
  occurrence: id,
  doers: v.optional(v.pipe(v.array(id), v.minLength(1), v.maxLength(100))),
});

/** A member it names, by id and name. */
interface Named {
  id: string;
  name: string;
}

type CompleteOccurrenceResult =
  | { ok: true; completionId: string }
  /** Not an occurrence's id, or no one who did it. */
  | { ok: false; error: 'invalid' }
  /** No such occurrence in the household, or someone who did it isn't one of its members. */
  | { ok: false; error: 'not-found' }
  /** Only members with an account log completions (ADR-0006 §4, ADR-0018 §4). */
  | { ok: false; error: 'not-allowed' }
  /** Closed as missed or away (ADR-0002 §2, ADR-0005 §5): there is nothing left to do. */
  | { ok: false; error: 'closed' }
  /**
   * It isn't in this plan week's published plan: only in a draft, or in another week's, such as
   * one it is carried over into, which hasn't begun.
   */
  | { ok: false; error: 'not-this-week' }
  /** Someone completed it already, as those who did it say (ADR-0019 §6). */
  | { ok: false; error: 'already-done'; doers: Named[] };

/**
 * Completes an open occurrence of this plan week's published plan with one tap (ADR-0006 §4): one
 * of the week's own, or one carried over into it from an earlier week. One the next week's plan
 * carries over is still this week's until the next begins (ADR-0002 §2, clarifications); done by
 * then, the next plan shows it done, as no work of its own. By whoever did it, or by any member
 * with an account on their behalf, the completion recording who did it and who logged it. Those
 * who did it together are each credited at their own cost (ADR-0002 §1); one who isn't its
 * assignee picks it up, and the weekly settlement credits them, not the assignee (§4). Logging it
 * for someone else is written to the activity log, once per member credited besides whoever logs
 * it (ADR-0018 §5), and so is picking it up, once per member credited, as done to its assignee
 * (§5, clarification). An occurrence is done once: the same completion sent again changes nothing,
 * and any other finds it done, with who did it (ADR-0019 §6).
 */
export async function completeOccurrence(
  context: HouseholdContext,
  input: unknown,
): Promise<CompleteOccurrenceResult> {
  const parsed = v.safeParse(completeInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const actor = context.member;
  const doerIds = [...new Set(parsed.output.doers ?? [actor.id])];
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<CompleteOccurrenceResult> => {
    const doers = await membersOf(tx, doerIds);
    if (doers.length !== doerIds.length) return { ok: false, error: 'not-found' };
    if (!doers.every((member) => can(actor, { action: 'completion.log', member }))) {
      return { ok: false, error: 'not-allowed' };
    }
    // Locked, so of two taps at the same moment, the second finds it done.
    const [occurrence] = await tx
      .select({ status: occurrences.status, duration: tasks.duration })
      .from(occurrences)
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(eq(occurrences.id, parsed.output.occurrence))
      .for('update', { of: occurrences });
    if (!occurrence) return { ok: false, error: 'not-found' };
    if (occurrence.status === 'done') {
      return alreadyDone(tx, parsed.output.occurrence, actor.id, doerIds);
    }
    if (occurrence.status !== 'open') return { ok: false, error: 'closed' };

    const now = context.clock.now();
    const week = await thisPlanWeek(tx, now);
    const [planned] = await tx
      .select({ planId: plans.id, assignee: assignments.memberId })
      .from(assignments)
      .innerJoin(plans, eq(plans.id, assignments.planId))
      .where(
        and(
          eq(assignments.occurrenceId, parsed.output.occurrence),
          eq(plans.weekStart, week.start.toString()),
          eq(plans.status, 'published'),
        ),
      );
    if (!planned) return { ok: false, error: 'not-this-week' };

    const at = new Date(now.epochMilliseconds);
    const [completion] = await tx
      .insert(completions)
      .values({
        householdId,
        occurrenceId: parsed.output.occurrence,
        planId: planned.planId,
        loggedBy: actor.id,
        at,
      })
      .returning({ id: completions.id });
    if (!completion) throw new Error('No completion was written.');
    // Every burden is 1.0 until the comparison game brings evidence (ADR-0003 §2), as in the plan.
    const task = {
      duration: occurrence.duration,
      burden: new Map(doerIds.map((doer) => [doer, 1])),
    };
    await tx.insert(completionCredits).values(
      creditsOf(task, doerIds).map(({ member, points }) => ({
        householdId,
        completionId: completion.id,
        memberId: member,
        points,
      })),
    );
    await tx
      .update(occurrences)
      .set({ status: 'done' })
      .where(eq(occurrences.id, parsed.output.occurrence));
    const others = doerIds.filter((doer) => doer !== actor.id);
    // Done by others than its assignee, it was picked up: their work now, which the assignee sees
    // in the log, once per member credited (ADR-0006 §3, ADR-0018 §5, clarification).
    const { assignee } = planned;
    const pickers = assignee === null || doerIds.includes(assignee) ? [] : doerIds;
    const entries = [
      ...others.map((subjectId) => ({
        actorId: actor.id,
        action: 'completion.logged' as const,
        subjectId,
      })),
      ...pickers.map((picker) => ({
        actorId: picker,
        action: 'completion.picked-up' as const,
        subjectId: assignee,
      })),
    ];
    if (entries.length > 0) {
      await tx.insert(activityLog).values(entries.map((entry) => ({ householdId, at, ...entry })));
    }
    return { ok: true, completionId: completion.id };
  });
}

/** The members of the household among `ids`, as permissions see them. */
async function membersOf(tx: Transaction, ids: readonly string[]): Promise<Member[]> {
  const rows = await tx
    .select({ id: members.id, role: members.role, accountId: members.accountId })
    .from(members)
    .where(inArray(members.id, [...ids]));
  // Their own second factor plays no part in who may log for them.
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    hasAccount: row.accountId !== null,
    twoFactor: false,
  }));
}

/**
 * For an occurrence done already: the same completion sent again, by whoever logged it for the
 * same members, changes nothing (ADR-0008 §7, ADR-0019 §6); any other is told who did it.
 */
async function alreadyDone(
  tx: Transaction,
  occurrenceId: string,
  actorId: string,
  doerIds: readonly string[],
): Promise<CompleteOccurrenceResult> {
  const [completion] = await tx
    .select({ id: completions.id, loggedBy: completions.loggedBy })
    .from(completions)
    .where(eq(completions.occurrenceId, occurrenceId));
  if (!completion) throw new Error('A done occurrence without its completion.');
  const doers = await creditedMembers(tx, completion.id);
  const same =
    completion.loggedBy === actorId &&
    doers.length === doerIds.length &&
    doers.every((doer) => doerIds.includes(doer.id));
  if (same) return { ok: true, completionId: completion.id };
  return { ok: false, error: 'already-done', doers };
}
