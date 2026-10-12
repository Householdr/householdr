import {
  assignments,
  households,
  inHousehold,
  members,
  occurrences,
  plans,
  tasks,
} from '@householdr/db';
import {
  can,
  planTimes,
  planWeek,
  type PlanStatus,
  type Reason,
  type Role,
  type UnassignedCause,
} from '@householdr/domain';
import { eq, inArray } from 'drizzle-orm';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from './planning';

/** An occurrence in a plan, as the plan's page shows it. */
interface PlanItem {
  /** Its assignment's id. */
  id: string;
  /** Its task's name, as typed (ADR-0016 §6). */
  task: string;
  /** Its schedule date. */
  date: Temporal.PlainDate;
  /** When it can be done in this plan, in the household's time zone. */
  window: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime };
}

/** An occurrence given to a member, and why (ADR-0001 §7). */
export interface PlannedAssignment extends PlanItem {
  /**
   * The points it costs the member viewing it, for their own only: another's cost would tell how
   * hard they find the task, which only they see (ADR-0003 §5).
   */
  cost: number | null;
  reason: Reason;
}

/** An occurrence nobody could take, and why, which heads see (ADR-0001 §7, clarification). */
export interface UnassignedOccurrence extends PlanItem {
  cause: UnassignedCause;
}

/** A member's part of a plan. */
export interface MemberPlan {
  id: string;
  name: string;
  role: Role;
  /** In the order they can be done. */
  assignments: PlannedAssignment[];
}

/** A plan week's plan, as a member sees it. */
export interface WeekPlan {
  /** Its first day, and the day after its last. */
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
  status: PlanStatus;
  /** What publishing it early is done from (ADR-0019 §5). */
  version: number;
  /**
   * When a draft is published, unless a head does it earlier (ADR-0006 §2); none once it is, nor
   * for the draft of a week begun already, such as the one a household started in, which only a
   * head publishes (ADR-0007 §3).
   */
  publishAt: Temporal.ZonedDateTime | null;
  /** Every member, heads first, then adults and children, each by name. */
  members: MemberPlan[];
  /** What nobody could take: for heads; empty for anyone else. */
  unassigned: UnassignedOccurrence[];
}

type ViewPlanResult =
  | {
      ok: true;
      /** The household's name, and the time zone its times are in. */
      household: string;
      timeZone: string;
      /** The plans of this plan week and the next that the member viewing may see. */
      thisWeek: WeekPlan | null;
      nextWeek: WeekPlan | null;
      /** Whether they see drafts, and may publish one early: heads with two factors. */
      mayPublish: boolean;
    }
  | { ok: false; error: 'not-allowed' };

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/**
 * The plans of this plan week and the next, as the member viewing them may see them (ADR-0006 §2,
 * clarification): published ones for every member, and drafts for heads only, who also see what
 * nobody could take and why. Every assignment says why it went to its member (ADR-0007 §5).
 */
export async function viewPlan(context: HouseholdContext): Promise<ViewPlanResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const mayPublish = can(context.member, { action: 'plan.draft' });
  return inHousehold(context.db, context.householdId, async (tx) => {
    const { calendar, timings } = await planningOf(tx);
    const { timeZone } = calendar;
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const today = context.clock.now().toZonedDateTimeISO(timeZone).toPlainDate();
    const current = planWeek(today, calendar);
    const next = planWeek(current.end, calendar);
    const found = await tx
      .select({
        id: plans.id,
        weekStart: plans.weekStart,
        weekEnd: plans.weekEnd,
        status: plans.status,
        version: plans.version,
      })
      .from(plans)
      .where(inArray(plans.weekStart, [current.start.toString(), next.start.toString()]));
    // Only heads see a draft until it is published (ADR-0006 §2, clarification).
    const visible = found.filter((plan) => plan.status === 'published' || mayPublish);
    const people = await tx
      .select({ id: members.id, name: members.name, role: members.role })
      .from(members);
    people.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    const items =
      visible.length === 0
        ? []
        : await tx
            .select({
              id: assignments.id,
              planId: assignments.planId,
              memberId: assignments.memberId,
              cost: assignments.cost,
              reason: assignments.reason,
              cause: assignments.unassignedCause,
              windowStart: assignments.windowStart,
              windowEnd: assignments.windowEnd,
              date: occurrences.date,
              task: tasks.name,
            })
            .from(assignments)
            .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
            .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
            .where(
              inArray(
                assignments.planId,
                visible.map((plan) => plan.id),
              ),
            );
    const zoned = (at: Date) =>
      Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
    const item = (row: (typeof items)[number]): PlanItem => ({
      id: row.id,
      task: row.task,
      date: Temporal.PlainDate.from(row.date),
      window: { start: zoned(row.windowStart), end: zoned(row.windowEnd) },
    });
    const inOrder = (a: PlanItem, b: PlanItem) =>
      Temporal.ZonedDateTime.compare(a.window.start, b.window.start) ||
      Temporal.PlainDate.compare(a.date, b.date) ||
      a.task.localeCompare(b.task) ||
      a.id.localeCompare(b.id);

    const weekPlan = (start: Temporal.PlainDate): WeekPlan | null => {
      const plan = visible.find((p) => p.weekStart === start.toString());
      if (!plan) return null;
      const own = items.filter((row) => row.planId === plan.id);
      const end = Temporal.PlainDate.from(plan.weekEnd);
      return {
        start,
        end,
        status: plan.status,
        version: plan.version,
        publishAt:
          plan.status === 'draft' && Temporal.PlainDate.compare(today, start) < 0
            ? planTimes({ start, end }, calendar, timings).publish.toZonedDateTimeISO(timeZone)
            : null,
        members: people.map((person) => ({
          ...person,
          assignments: own
            .filter((row) => row.memberId === person.id)
            .map((row) => {
              if (row.reason === null) throw new Error('An assignment without a reason.');
              return {
                ...item(row),
                cost: person.id === context.member.id ? row.cost : null,
                reason: row.reason,
              };
            })
            .sort(inOrder),
        })),
        unassigned: mayPublish
          ? own
              .flatMap((row) => (row.cause === null ? [] : [{ ...item(row), cause: row.cause }]))
              .sort(inOrder)
          : [],
      };
    };
    return {
      ok: true as const,
      household: household.name,
      timeZone,
      thisWeek: weekPlan(current.start),
      nextWeek: weekPlan(next.start),
      mayPublish,
    };
  });
}
