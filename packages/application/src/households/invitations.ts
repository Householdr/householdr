import { createHash, randomBytes } from 'node:crypto';
import {
  accounts,
  households,
  inHousehold,
  invitationHousehold,
  invitations,
  members,
  type Database,
  type Transaction,
} from '@householdr/db';
import { can } from '@householdr/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import type { Clock } from '../ports';
import type { HouseholdContext } from './membership';

/** How long an invitation link works (ADR-0010 §5). */
const linkLifetime = { hours: 7 * 24 } as const;

/**
 * What opening or accepting an invitation needs, before any household is known: the database, or
 * the transaction that creates the account accepting it.
 */
export interface InvitationContext {
  db: Database | Transaction;
  clock: Clock;
}

/** The hash of a link's token, which is all the database keeps of it (SEC-7). */
const hashOf = (token: string) => createHash('sha256').update(token).digest('base64url');

/** A token from a link: 32 random bytes in base64url, so 43 characters (CODE-12). */
const linkToken = v.pipe(v.string(), v.regex(/^[\w-]{43}$/));

/** Which profile a head invites, or whose link they revoke (CODE-12). */
const profile = v.object({ member: v.pipe(v.string(), v.uuid()) });

type InviteResult =
  /** The link's token, shown to the head once: only its hash is kept. */
  | { ok: true; token: string; expiresAt: Temporal.Instant }
  /** Only heads invite, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** No adult's profile without an account by that id in the household. */
  | { ok: false; error: 'not-found' };

/**
 * Makes the invitation link of an adult's profile without an account (ADR-0010 §5): random, single
 * use, for 7 days, replacing any link the profile had. Children are invited only from the consent
 * age (§7, §9), which comes with their profiles.
 */
export async function invite(context: HouseholdContext, input: unknown): Promise<InviteResult> {
  if (!can(context.member, { action: 'household.invite' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(profile, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  const memberId = parsed.output.member;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = context.clock.now().add(linkLifetime);
  const invited = await inHousehold(context.db, context.householdId, async (tx) => {
    const [invitable] = await tx
      .select({ accountId: members.accountId, role: members.role })
      .from(members)
      .where(eq(members.id, memberId))
      .for('update');
    if (invitable?.role !== 'adult' || invitable.accountId !== null) return false;
    await tx
      .insert(invitations)
      .values({
        memberId,
        householdId: context.householdId,
        tokenHash: hashOf(token),
        expiresAt: new Date(expiresAt.epochMilliseconds),
      })
      .onConflictDoUpdate({
        target: invitations.memberId,
        set: { tokenHash: hashOf(token), expiresAt: new Date(expiresAt.epochMilliseconds) },
      });
    return true;
  });
  return invited ? { ok: true, token, expiresAt } : { ok: false, error: 'not-found' };
}

type RevokeInvitationResult = { ok: true } | { ok: false; error: 'not-allowed' };

/** Revokes the link of a profile, if it has one: it no longer works (ADR-0010 §5). */
export async function revokeInvitation(
  context: HouseholdContext,
  input: unknown,
): Promise<RevokeInvitationResult> {
  if (!can(context.member, { action: 'household.invite' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(profile, input);
  if (parsed.success) {
    await inHousehold(context.db, context.householdId, (tx) =>
      tx.delete(invitations).where(eq(invitations.memberId, parsed.output.member)),
    );
  }
  return { ok: true };
}

/** An invitation as the person opening its link sees it. */
export interface OpenInvitation {
  /** The household's name. */
  household: string;
  /** The name of the profile the link joins. */
  profile: string;
  /** The household's country, which with a new account's language makes its culture (ADR-0016 §2). */
  country: string;
}

/** The household of a link's `token` and the token's hash, if the token has an invitation. */
async function findInvitation(context: InvitationContext, token: unknown) {
  if (!v.is(linkToken, token)) return null;
  const tokenHash = hashOf(token);
  const householdId = await invitationHousehold(context.db, tokenHash);
  if (!householdId) return null;
  return { householdId, tokenHash };
}

/**
 * The invitation of a link's `token`, if it still works: not used, revoked, replaced or expired
 * (ADR-0010 §5). Anyone holding the link may see what it invites to.
 */
export async function openInvitation(
  context: InvitationContext,
  token: unknown,
): Promise<OpenInvitation | null> {
  const found = await findInvitation(context, token);
  if (!found) return null;
  const now = new Date(context.clock.now().epochMilliseconds);
  return inHousehold(context.db, found.householdId, async (tx) => {
    const [row] = await tx
      .select({
        household: households.name,
        profile: members.name,
        country: households.country,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(members, eq(members.id, invitations.memberId))
      .innerJoin(households, eq(households.id, invitations.householdId))
      .where(eq(invitations.tokenHash, found.tokenHash));
    if (!row || row.expiresAt <= now) return null;
    return { household: row.household, profile: row.profile, country: row.country };
  });
}

type AcceptInvitationResult =
  | { ok: true; householdId: string }
  /** The link doesn't work any more: used, revoked, replaced or expired (ADR-0010 §5). */
  | { ok: false; error: 'expired' }
  /** The account already has a profile in that household (§5). */
  | { ok: false; error: 'member' }
  /** The account's e-mail address isn't confirmed, which joining a household needs (§1). */
  | { ok: false; error: 'not-allowed' };

/**
 * Accepts the invitation of a link's `token` for the signed-in account `accountId`: links it to the
 * profile, which keeps its history, and uses up the link (ADR-0010 §5). Whoever holds the link can
 * accept it; heads see who did.
 */
export async function acceptInvitation(
  context: InvitationContext,
  accountId: string,
  token: unknown,
): Promise<AcceptInvitationResult> {
  const [account] = await context.db
    .select({ verified: accounts.emailVerified })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!account?.verified) return { ok: false, error: 'not-allowed' };
  const found = await findInvitation(context, token);
  if (!found) return { ok: false, error: 'expired' };
  const now = new Date(context.clock.now().epochMilliseconds);
  return inHousehold(context.db, found.householdId, async (tx) => {
    // Locked, so that of two people accepting the same link at once only one gets it.
    const [invitation] = await tx
      .select({ memberId: invitations.memberId, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.tokenHash, found.tokenHash))
      .for('update');
    if (!invitation || invitation.expiresAt <= now) return { ok: false, error: 'expired' } as const;
    const [already] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId));
    if (already) return { ok: false, error: 'member' } as const;
    const [linked] = await tx
      .update(members)
      .set({ accountId, version: sql`${members.version} + 1` })
      .where(
        and(
          eq(members.id, invitation.memberId),
          eq(members.role, 'adult'),
          isNull(members.accountId),
        ),
      )
      .returning({ id: members.id });
    if (!linked) return { ok: false, error: 'expired' } as const;
    await tx.delete(invitations).where(eq(invitations.memberId, invitation.memberId));
    return { ok: true, householdId: found.householdId } as const;
  });
}
