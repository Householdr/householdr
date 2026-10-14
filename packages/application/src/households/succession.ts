import { inHousehold, members, type Transaction } from '@householdr/db';
import { can, headCandidates, type Member } from '@householdr/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { planningOf } from '../plans/planning';
import { isCurrentMember } from './former-members';
import type { HouseholdContext } from './context';

// Who becomes head when the household's last head leaves (ADR-0018 §2, with its clarifications).

/** Whether `member` is the household's last head, whose role passes as they leave. */
export async function isLastHead(tx: Transaction, member: Pick<Member, 'id' | 'role'>) {
  if (member.role !== 'head') return false;
  const [otherHead] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.role, 'head'), ne(members.id, member.id), isCurrentMember));
  return !otherHead;
}

/**
 * The household's members who can become head when its last head leaves, or the one they named
 * declines, longest in it first (ADR-0018 §2, with its clarifications). Leaving and declining hold
 * the planning lock, as ending any membership does, so they are still members when the role passes.
 */
export async function successors(tx: Transaction) {
  const rows = await tx
    .select({
      id: members.id,
      name: members.name,
      role: members.role,
      accountId: members.accountId,
      joinedAt: members.joinedAt,
    })
    .from(members)
    .where(isCurrentMember);
  return headCandidates(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      hasAccount: row.accountId !== null,
      joinedAt: Temporal.Instant.fromEpochMilliseconds(row.joinedAt.getTime()),
    })),
  ).map(({ id, name }) => ({ id, name }));
}

/** The answer of a member the last head named head: they take it on, or decline it (CODE-12). */
const answering = v.object({ answer: v.picklist(['take on', 'decline']) });

type AnswerHeadRoleResult =
  | { ok: true }
  /** Not a member the last head named head who hasn't answered yet. */
  | { ok: false; error: 'not-allowed' }
  /** Declining, as the only adult with an account, whom nobody could take it over from. */
  | { ok: false; error: 'only-adult' }
  /** Not an answer. */
  | { ok: false; error: 'invalid' };

/**
 * The member acting, whom the household's last head named head as they left, takes the role on or
 * declines it (ADR-0018 §2, ADR-0010 §3, clarifications). Taking it on keeps it. Declining makes
 * them an adult member again and, unless another head remains, passes the role to the adult with
 * an account longest in the household; the only adult with an account can't. Neither is logged,
 * as the leaving it follows isn't (ADR-0018 §8).
 */
export async function answerHeadRole(
  context: HouseholdContext,
  input: unknown,
): Promise<AnswerHeadRoleResult> {
  const self = context.member;
  if (!can(self, { action: 'member.stepDown', member: self })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(answering, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  return inHousehold(context.db, context.householdId, async (tx): Promise<AnswerHeadRoleResult> => {
    // Locked, as leaving locks it: the role may pass.
    await planningOf(tx, { lock: true });
    const [named] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, self.id), eq(members.namedHead, true)))
      .for('update');
    if (!named) return { ok: false, error: 'not-allowed' };
    const answered = { namedHead: false, version: sql`${members.version} + 1` };
    if (parsed.output.answer === 'take on') {
      await tx.update(members).set(answered).where(eq(members.id, self.id));
      return { ok: true };
    }
    const [next] = (await isLastHead(tx, self)) ? await successors(tx) : [null];
    if (next === undefined) return { ok: false, error: 'only-adult' };
    await tx
      .update(members)
      .set({ ...answered, role: 'adult' })
      .where(eq(members.id, self.id));
    if (next) {
      await tx
        .update(members)
        .set({ role: 'head', version: sql`${members.version} + 1` })
        .where(eq(members.id, next.id));
    }
    return { ok: true };
  });
}
