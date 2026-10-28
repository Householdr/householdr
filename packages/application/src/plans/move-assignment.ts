import {
  activityLog,
  assignments,
  atVersion,
  inHousehold,
  members,
  nextVersion,
  occurrences,
  plans,
  tasks,
  type Transaction,
} from '@householdr/db';
import { can, householdDate } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from './planning';

/** What moving sends (CODE-12): the assignment, the version of it the head saw, and to whom. */
const moveInput = v.object({
  assignment: v.pipe(v.string(), v.uuid()),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  member: v.pipe(v.string(), v.uuid()),
});

type MoveAssignmentResult =
  | { ok: true }
  /** Only heads move occurrences, once signed in with two factors (ADR-0006 §2–§3). */
  | { ok: false; error: 'not-allowed' }
  /** Not an assignment, version and member. */
  | { ok: false; error: 'invalid' }
  /** No such assignment, or no such member, in the household. */
  | { ok: false; error: 'not-found' }
  /** Done already, or in a plan whose week is over: it stays as it is. */
  | { ok: false; error: 'not-movable' }
  /** It changed since the head saw it (ADR-0019 §5). */
  | { ok: false; error: 'conflict' };

/**
 * Moves an open occurrence of a plan to a member, by a head (ADR-0006 §2–§3): in a draft, as a
 * pre-assignment that drafting it again keeps (ADR-0001 §7); in a published plan whose week isn't
 * over, as a reassignment, the explicit event that changes a frozen plan. Either way its reason is
 * "assigned by head", and it costs the member its minutes times their burden, which is the prior
 * until the comparison game brings evidence (ADR-0003 §2). A reassignment after publishing is
 * logged, naming whom it was taken from and given to (ADR-0018 §5); one in a draft isn't, as only
 * heads see a draft (ADR-0006 §2, clarification).
 */
export async function moveAssignment(
  context: HouseholdContext,
  input: unknown,
): Promise<MoveAssignmentResult> {
  const mayDraft = can(context.member, { action: 'plan.draft' });
  const mayReassign = can(context.member, { action: 'plan.reassign' });
  if (!mayDraft && !mayReassign) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(moveInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { assignment, version, member } = parsed.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<MoveAssignmentResult> => {
    const [row] = await tx
      .select({
        planId: plans.id,
        planStatus: plans.status,
        weekEnd: plans.weekEnd,
        memberId: assignments.memberId,
        version: assignments.version,
        status: occurrences.status,
        task: tasks.name,
        duration: tasks.duration,
      })
      .from(assignments)
      .innerJoin(plans, eq(plans.id, assignments.planId))
      .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(eq(assignments.id, assignment));
    const [target] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, member));
    if (!row || !target) return { ok: false, error: 'not-found' };
    const published = row.planStatus === 'published';
    if (!(published ? mayReassign : mayDraft)) return { ok: false, error: 'not-allowed' };
    const { calendar } = await planningOf(tx);
    const today = householdDate(context.clock.now(), calendar.timeZone);
    const over = Temporal.PlainDate.compare(today, Temporal.PlainDate.from(row.weekEnd)) >= 0;
    if (row.status !== 'open' || over) return { ok: false, error: 'not-movable' };
    if (row.version !== version) return { ok: false, error: 'conflict' };
    // Moving it to whoever has it changes nothing (CODE-19).
    if (row.memberId === member) return { ok: true };
    const moved = await tx
      .update(assignments)
      .set({
        memberId: member,
        cost: row.duration,
        reason: 'assigned by head',
        unassignedCause: null,
        version: nextVersion(assignments),
      })
      .where(atVersion(assignments, assignment, version))
      .returning({ id: assignments.id });
    if (moved.length === 0) return { ok: false, error: 'conflict' };
    if (published) {
      await logMove(tx, context, { from: row.memberId, to: member, task: row.task });
    } else {
      // A head publishes the draft as it is now (ADR-0019 §5).
      await tx
        .update(plans)
        .set({ version: nextVersion(plans) })
        .where(eq(plans.id, row.planId));
    }
    return { ok: true };
  });
}

/**
 * Logs a reassignment after publishing (ADR-0018 §5): that the task was taken off whoever had it
 * and given to its new member, naming the task, which every member sees in the plan anyway. A head
 * acting on their own part isn't logged as done to them.
 */
async function logMove(
  tx: Transaction,
  context: HouseholdContext,
  { from, to, task }: { from: string | null; to: string; task: string },
) {
  const actorId = context.member.id;
  const at = new Date(context.clock.now().epochMilliseconds);
  const entry = (action: 'assignment.taken' | 'assignment.given', subjectId: string) => ({
    householdId: context.householdId,
    at,
    actorId,
    action,
    subjectId,
    taskName: task,
  });
  const entries = [
    ...(from !== null && from !== actorId ? [entry('assignment.taken', from)] : []),
    ...(to === actorId ? [] : [entry('assignment.given', to)]),
  ];
  if (entries.length > 0) await tx.insert(activityLog).values(entries);
}
