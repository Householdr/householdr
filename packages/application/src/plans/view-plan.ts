import {
  assignments,
  completionCredits,
  completions,
  households,
  inHousehold,
  members,
  occurrences,
  plans,
  tasks,
  type Transaction,
} from '@householdr/db';
import {
  can,
  planTimes,
  planWeek,
  type Member,
  type PlanStatus,
  type Reason,
  type Role,
  type UnassignedCause,
} from '@householdr/domain';
import { asc, eq, inArray } from 'drizzle-orm';
import { inPlanWeek } from '../completions/completion-week';
import type { HouseholdContext } from '../households/membership';
import { planningOf } from './planning';

/** A member a completion names, by id and name. */
interface Named {
  id: string;
  name: string;
}

/** How an occurrence was completed, as the member viewing it may see it (ADR-0006 §4). */
export interface PlanCompletion {
  id: string;
  /** The day it was done, in the household's time zone, which every member sees. */
  day: Temporal.PlainDate;
  /**
   * When exactly, for the members it credits only: anyone else sees the day (ADR-0018 §3). Tasks
   * with a fixed window, whose times everyone sees, don't exist yet.
   */
  at: Temporal.ZonedDateTime | null;
  /** Who did it, by name. */
  doers: Named[];
  /** Who logged it, one of them or someone on their behalf. */
  loggedBy: Named;
  /** Whether the member viewing may undo it now: within its plan week (ADR-0006 §4). */
  mayUndo: boolean;
}

/** An occurrence in a plan, as the plan's page shows it. */
interface PlanItem {
  /** Its assignment's id. */
  id: string;
  /** Its occurrence's id, which completing it names. */
  occurrence: string;
  /** Its task's name, as typed (ADR-0016 §6). */
  task: string;
  /** Its schedule date. */
  date: Temporal.PlainDate;
  /** When it can be done in this plan, in the household's time zone. */
  window: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime };
  /**
   * Whether the member viewing may complete it now: still open, in this plan week's published
   * plan (ADR-0006 §4).
   */
  completable: boolean;
  /** Its completion, once it is done. */
  completion: PlanCompletion | null;
}

/** An occurrence given to a member, and why (ADR-0001 §7). */
export interface PlannedAssignment extends PlanItem {
  /**
   * The points it costs the member viewing it, for their own only: another's cost would tell how
   * hard they find the task, which only they see (ADR-0003 §5). None for one carried over that
   * was done in its own week after all, which is no longer this week's work (ADR-0002 §2).
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
      .select({
        id: members.id,
        name: members.name,
        role: members.role,
        accountId: members.accountId,
      })
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
              occurrence: occurrences.id,
              status: occurrences.status,
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
    const completed = await completionsOf(
      tx,
      items.filter((row) => row.status === 'done').map((row) => row.occurrence),
    );
    const named = new Map(people.map((person) => [person.id, person]));
    // Completions name members of the household only, whose profiles their keys keep.
    const personOf = (id: string) => {
      const person = named.get(id);
      if (!person) throw new Error('A completion names a member who is gone.');
      return person;
    };
    const nameOf = (id: string): Named => ({ id, name: personOf(id).name });
    // As permissions see them: their own second factor plays no part in who sees what.
    const asMember = (id: string): Member => {
      const { role, accountId } = personOf(id);
      return { id, role, hasAccount: accountId !== null, twoFactor: false };
    };
    const completionOf = (occurrence: string): PlanCompletion | null => {
      const done = completed.get(occurrence);
      if (!done) return null;
      const at = zoned(done.at);
      const credited = done.doers.map(asMember);
      const { loggedBy } = done;
      return {
        id: done.id,
        day: at.toPlainDate(),
        at: credited.some((member) => can(context.member, { action: 'exactTimes.view', member }))
          ? at
          : null,
        doers: done.doers.map(nameOf),
        loggedBy: nameOf(loggedBy),
        mayUndo: can(context.member, {
          action: 'completion.undo',
          loggedBy,
          credited: done.doers,
          inPlanWeek: inPlanWeek(done, today),
        }),
      };
    };
    // Only this plan week's published plan is done from (ADR-0006 §4).
    const mayLog = can(context.member, { action: 'completion.log', member: context.member });
    const item = (row: (typeof items)[number], plan: (typeof visible)[number]): PlanItem => ({
      id: row.id,
      occurrence: row.occurrence,
      task: row.task,
      date: Temporal.PlainDate.from(row.date),
      window: { start: zoned(row.windowStart), end: zoned(row.windowEnd) },
      completable:
        mayLog &&
        row.status === 'open' &&
        plan.status === 'published' &&
        plan.weekStart === current.start.toString(),
      completion: row.status === 'done' ? completionOf(row.occurrence) : null,
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
      // Carried over from an earlier week, and done there before this one began: it shows as done,
      // but isn't this week's work (ADR-0002 §2, clarifications).
      const doneBefore = (row: (typeof items)[number]) => {
        const done = completed.get(row.occurrence);
        if (!done) return false;
        const doneIn = Temporal.PlainDate.from(done.weekStart);
        return Temporal.PlainDate.compare(doneIn, Temporal.PlainDate.from(plan.weekStart)) < 0;
      };
      return {
        start,
        end,
        status: plan.status,
        version: plan.version,
        publishAt:
          plan.status === 'draft' && Temporal.PlainDate.compare(today, start) < 0
            ? planTimes({ start, end }, calendar, timings).publish.toZonedDateTimeISO(timeZone)
            : null,
        members: people.map(({ id, name, role }) => ({
          id,
          name,
          role,
          assignments: own
            .filter((row) => row.memberId === id)
            .map((row) => {
              if (row.reason === null) throw new Error('An assignment without a reason.');
              return {
                ...item(row, plan),
                cost: id === context.member.id && !doneBefore(row) ? row.cost : null,
                reason: row.reason,
              };
            })
            .sort(inOrder),
        })),
        unassigned: mayPublish
          ? own
              .flatMap((row) =>
                row.cause === null ? [] : [{ ...item(row, plan), cause: row.cause }],
              )
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

/**
 * The completions of `occurrenceIds`, by occurrence: when, who logged it, whom it credits by id,
 * and the days of the plan week it was done in.
 */
async function completionsOf(tx: Transaction, occurrenceIds: string[]) {
  if (occurrenceIds.length === 0) return new Map<string, Completed>();
  const rows = await tx
    .select({
      id: completions.id,
      occurrence: completions.occurrenceId,
      at: completions.at,
      loggedBy: completions.loggedBy,
      weekStart: plans.weekStart,
      weekEnd: plans.weekEnd,
    })
    .from(completions)
    .innerJoin(plans, eq(plans.id, completions.planId))
    .where(inArray(completions.occurrenceId, occurrenceIds));
  const credits = await tx
    .select({ completion: completionCredits.completionId, member: completionCredits.memberId })
    .from(completionCredits)
    .innerJoin(members, eq(members.id, completionCredits.memberId))
    .where(
      inArray(
        completionCredits.completionId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(members.name), asc(members.id));
  return new Map(
    rows.map((row): [string, Completed] => [
      row.occurrence,
      { ...row, doers: credits.filter((c) => c.completion === row.id).map((c) => c.member) },
    ]),
  );
}

/** A completion as `completionsOf` reads it. */
interface Completed {
  id: string;
  at: Date;
  loggedBy: string;
  /** Whom it credits, by id, by name. */
  doers: string[];
  /** The plan week it was done in, as `YYYY-MM-DD`. */
  weekStart: string;
  weekEnd: string;
}
