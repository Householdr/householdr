import {
  activityLog,
  assignments,
  inHousehold,
  members,
  nextVersion,
  occurrences,
  plans,
  swaps,
  tasks,
  type Transaction,
} from '@householdr/db';
import { can, householdDate, swapEffect, type Member } from '@householdr/domain';
import { and, eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';
import { balancesOf } from '../ledger/balances';
import { householdBurdens } from '../burdens/household-burdens';
import { planningOf } from './planning';

const id = v.pipe(v.string(), v.uuid());

/** What proposing sends (CODE-12): whose occurrence, which, to whom, and theirs in return, if any. */
const proposeInput = v.object({
  from: id,
  give: id,
  to: id,
  take: v.optional(id),
});

/** What answering sends (CODE-12). */
const answerInput = v.object({ swap: id, accept: v.boolean() });

/** Member `memberId` of the household, as permissions see them, if there is one. */
async function memberOf(tx: Transaction, memberId: string): Promise<Member | undefined> {
  const [row] = await tx
    .select({ id: members.id, role: members.role, accountId: members.accountId })
    .from(members)
    .where(eq(members.id, memberId));
  return (
    row && { id: row.id, role: row.role, hasAccount: row.accountId !== null, twoFactor: false }
  );
}

/**
 * Assignments `ids` as a swap needs them: whose they are, whether their occurrence is still open,
 * whether their plan is published and its week not over at `today`, and their task's minutes.
 */
async function swappable(tx: Transaction, ids: string[], today: Temporal.PlainDate) {
  const rows = await tx
    .select({
      id: assignments.id,
      planId: assignments.planId,
      memberId: assignments.memberId,
      open: occurrences.status,
      planStatus: plans.status,
      weekEnd: plans.weekEnd,
      duration: tasks.duration,
      taskId: tasks.id,
    })
    .from(assignments)
    .innerJoin(plans, eq(plans.id, assignments.planId))
    .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(inArray(assignments.id, ids));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        live:
          row.open === 'open' &&
          row.planStatus === 'published' &&
          Temporal.PlainDate.compare(today, Temporal.PlainDate.from(row.weekEnd)) < 0,
      },
    ]),
  );
}

/** Logs a head acting on a swap for a profile without an account (ADR-0002 §5, clarification). */
async function logForProfile(
  tx: Transaction,
  context: HouseholdContext,
  action: 'swap.proposed' | 'swap.answered',
  subject: Member,
) {
  if (subject.id === context.member.id || subject.hasAccount) return;
  await tx.insert(activityLog).values({
    householdId: context.householdId,
    at: new Date(context.clock.now().epochMilliseconds),
    actorId: context.member.id,
    action,
    subjectId: subject.id,
  });
}

type ProposeSwapResult =
  | { ok: true; swapId: string }
  /** Only the member, or a head for a profile without an account (ADR-0002 §5, clarification). */
  | { ok: false; error: 'not-allowed' }
  /** Not the ids of a proposal, or a swap with oneself. */
  | { ok: false; error: 'invalid' }
  /** No such member or assignment in the household, or not theirs. */
  | { ok: false; error: 'not-found' }
  /** Done, or in a plan that isn't published or whose week is over. */
  | { ok: false; error: 'not-swappable' }
  /** It is offered in another swap that waits for an answer already. */
  | { ok: false; error: 'already-proposed' };

/**
 * Proposes a swap (ADR-0002 §5): an open occurrence of member `from`'s, in a published plan whose
 * week isn't over, to member `to`, for an open occurrence of theirs in the same plan (a trade) or
 * nothing (a hand-off). `to` accepts or declines it. A head proposing for a profile without an
 * account is logged (ADR-0018 §5).
 */
export async function proposeSwap(
  context: HouseholdContext,
  input: unknown,
): Promise<ProposeSwapResult> {
  const parsed = v.safeParse(proposeInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { from, give, to, take } = parsed.output;
  if (from === to) return { ok: false, error: 'invalid' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<ProposeSwapResult> => {
    const proposer = await memberOf(tx, from);
    const other = await memberOf(tx, to);
    if (!proposer || !other) return { ok: false, error: 'not-found' };
    if (!can(context.member, { action: 'swaps.act', member: proposer })) {
      return { ok: false, error: 'not-allowed' };
    }
    const { calendar } = await planningOf(tx);
    const today = householdDate(context.clock.now(), calendar.timeZone);
    const found = await swappable(tx, take ? [give, take] : [give], today);
    const given = found.get(give);
    const taken = take ? found.get(take) : undefined;
    if (!given || given.memberId !== from) return { ok: false, error: 'not-found' };
    if (take && (!taken || taken.memberId !== to)) return { ok: false, error: 'not-found' };
    if (!given.live || (taken && (!taken.live || taken.planId !== given.planId))) {
      return { ok: false, error: 'not-swappable' };
    }
    const [added] = await tx
      .insert(swaps)
      .values({
        householdId: context.householdId,
        fromMember: from,
        toMember: to,
        give,
        take: take ?? null,
        proposedAt: new Date(context.clock.now().epochMilliseconds),
      })
      .onConflictDoNothing()
      .returning({ id: swaps.id });
    if (!added) return { ok: false, error: 'already-proposed' };
    await logForProfile(tx, context, 'swap.proposed', proposer);
    return { ok: true, swapId: added.id };
  });
}

type AnswerSwapResult =
  | { ok: true }
  /** Only the member it is proposed to, or a head for a profile without an account. */
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'invalid' }
  /** No swap waiting for an answer with that id in the household: answered already, say. */
  | { ok: false; error: 'not-found' }
  /** An occurrence in it was done, moved or its week ended since: it is void now. */
  | { ok: false; error: 'gone' };

/**
 * Accepts or declines a swap proposed to a member (ADR-0002 §5). Accepting reassigns the
 * occurrences, each to its new member at their own cost, with the reason "swapped"; what each owes
 * doesn't change, as it follows the allocation. One that can no longer go through, as an occurrence
 * in it was done, moved or its week ended, becomes void instead. A head answering for a profile
 * without an account is logged (ADR-0018 §5).
 */
export async function answerSwap(
  context: HouseholdContext,
  input: unknown,
): Promise<AnswerSwapResult> {
  const parsed = v.safeParse(answerInput, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { swap: swapId, accept } = parsed.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<AnswerSwapResult> => {
    const [swap] = await tx
      .select()
      .from(swaps)
      .where(and(eq(swaps.id, swapId), eq(swaps.status, 'pending')))
      .for('update');
    if (!swap) return { ok: false, error: 'not-found' };
    const answerer = await memberOf(tx, swap.toMember);
    if (!answerer || !can(context.member, { action: 'swaps.act', member: answerer })) {
      return { ok: false, error: 'not-allowed' };
    }
    const at = new Date(context.clock.now().epochMilliseconds);
    const answered = (status: 'accepted' | 'declined' | 'void') =>
      tx.update(swaps).set({ status, answeredAt: at }).where(eq(swaps.id, swap.id));
    if (!accept) {
      await answered('declined');
      await logForProfile(tx, context, 'swap.answered', answerer);
      return { ok: true };
    }
    const { calendar } = await planningOf(tx);
    const today = householdDate(context.clock.now(), calendar.timeZone);
    const found = await swappable(tx, swap.take ? [swap.give, swap.take] : [swap.give], today);
    const given = found.get(swap.give);
    const taken = swap.take ? found.get(swap.take) : undefined;
    const still =
      given?.live === true &&
      given.memberId === swap.fromMember &&
      (swap.take === null || (taken?.live === true && taken.memberId === swap.toMember));
    if (!still) {
      await answered('void');
      return { ok: false, error: 'gone' };
    }
    // Each at their own cost: their own burden (ADR-0003 §1).
    const burdenOf = await householdBurdens(tx, today);
    const reassign = (assignment: string, member: string, cost: number) =>
      tx
        .update(assignments)
        .set({ memberId: member, cost, reason: 'swapped', version: nextVersion(assignments) })
        .where(eq(assignments.id, assignment));
    await reassign(
      swap.give,
      swap.toMember,
      given.duration * burdenOf(given.taskId, swap.toMember),
    );
    if (swap.take && taken) {
      await reassign(
        swap.take,
        swap.fromMember,
        taken.duration * burdenOf(taken.taskId, swap.fromMember),
      );
    }
    await answered('accepted');
    // Another swap that offered either occurrence can no longer go through.
    const moved = swap.take ? [swap.give, swap.take] : [swap.give];
    await tx
      .update(swaps)
      .set({ status: 'void', answeredAt: at })
      .where(and(eq(swaps.status, 'pending'), inArray(swaps.give, moved)));
    await tx
      .update(swaps)
      .set({ status: 'void', answeredAt: at })
      .where(and(eq(swaps.status, 'pending'), inArray(swaps.take, moved)));
    await logForProfile(tx, context, 'swap.answered', answerer);
    return { ok: true };
  });
}

/** A swap waiting for an answer, as the plan's page shows it. */
export interface PendingSwap {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  /** The occurrences, by their assignments' ids. */
  give: string;
  take: string | null;
  /** Both balances now, and once each does what they then have (ADR-0002 §5). */
  balances: { from: { now: number; after: number }; to: { now: number; after: number } };
  /** Whether the member viewing may answer it: the member it is proposed to, or a head for them. */
  mayAnswer: boolean;
}

/**
 * The swaps waiting for an answer that the member viewing is in, or may act in for a profile
 * without an account, with what accepting would do to both balances, which every member sees anyway
 * (ADR-0002 §5–§6).
 */
export async function pendingSwaps(tx: Transaction, viewer: Member): Promise<PendingSwap[]> {
  const rows = await tx.select().from(swaps).where(eq(swaps.status, 'pending'));
  if (rows.length === 0) return [];
  const people = new Map(
    (
      await tx
        .select({
          id: members.id,
          name: members.name,
          role: members.role,
          accountId: members.accountId,
        })
        .from(members)
    ).map((row) => [row.id, row]),
  );
  const asMember = (memberId: string): Member | undefined => {
    const row = people.get(memberId);
    return (
      row && { id: row.id, role: row.role, hasAccount: row.accountId !== null, twoFactor: false }
    );
  };
  const minutes = new Map(
    (
      await tx
        .select({ id: assignments.id, duration: tasks.duration })
        .from(assignments)
        .innerJoin(occurrences, eq(occurrences.id, assignments.occurrenceId))
        .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
        .where(
          inArray(
            assignments.id,
            rows.flatMap((row) => (row.take ? [row.give, row.take] : [row.give])),
          ),
        )
    ).map((row) => [row.id, row.duration]),
  );
  const balances = await balancesOf(tx);
  return rows.flatMap((row) => {
    const from = asMember(row.fromMember);
    const to = asMember(row.toMember);
    if (!from || !to) return [];
    const mayAnswer = can(viewer, { action: 'swaps.act', member: to });
    if (!mayAnswer && !can(viewer, { action: 'swaps.act', member: from })) return [];
    const costOf = (assignment: string) => {
      const duration = minutes.get(assignment) ?? 0;
      return { from: duration, to: duration };
    };
    const effect = swapEffect(costOf(row.give), row.take ? costOf(row.take) : null);
    const now = (memberId: string) => balances.get(memberId) ?? 0;
    return [
      {
        id: row.id,
        from: { id: from.id, name: people.get(from.id)?.name ?? '' },
        to: { id: to.id, name: people.get(to.id)?.name ?? '' },
        give: row.give,
        take: row.take,
        balances: {
          from: { now: now(from.id), after: now(from.id) + effect.from },
          to: { now: now(to.id), after: now(to.id) + effect.to },
        },
        mayAnswer,
      },
    ];
  });
}
