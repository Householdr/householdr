import {
  accountHouseholds,
  accounts,
  credentials,
  households,
  inHousehold,
  invitations,
  members,
  passkeys,
  type Database,
  type Transaction,
} from '@householdr/db';
import {
  can,
  comingPlanTimes,
  hasTwoFactors,
  householdDate,
  mayRemovePasskey,
  mayTurnOffTotp,
  planWeek,
  type Member,
  type Role,
  type SignInMethods,
} from '@householdr/domain';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import * as v from 'valibot';
import { planningOf, type Planning } from '../plans/planning';
import type { HouseholdContext, HouseholdsContext } from './context';
import { isCurrentMember } from './former-members';
import { isLastHead, successors } from './succession';

export type { HouseholdContext, HouseholdsContext } from './context';

const householdId = v.pipe(v.string(), v.uuid());

/**
 * How the account signs in: with a passkey, a password, and codes from an app (ADR-0010 §2). With
 * `withoutPasskey`, as it would once that passkey is gone.
 */
async function signInMethods(
  db: Database | Transaction,
  accountId: string,
  withoutPasskey?: string,
): Promise<SignInMethods> {
  const otherPasskeys = and(
    eq(passkeys.userId, accountId),
    withoutPasskey === undefined ? undefined : ne(passkeys.id, withoutPasskey),
  );
  const [[passkey], [password], [account]] = await Promise.all([
    db.select({ id: passkeys.id }).from(passkeys).where(otherPasskeys).limit(1),
    db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.userId, accountId), isNotNull(credentials.password)))
      .limit(1),
    db.select({ totp: accounts.twoFactorEnabled }).from(accounts).where(eq(accounts.id, accountId)),
  ]);
  return {
    passkey: passkey !== undefined,
    password: password !== undefined,
    totp: account?.totp ?? false,
  };
}

/**
 * The member the signed-in account is in household `id`, as permissions see them, or null if it is
 * none of its members: what the guard checks before anything in a household (ADR-0017 §2). Head
 * powers wait for two factors: a passkey, or a password with TOTP (ADR-0010 §3).
 */
export async function membership(
  context: HouseholdsContext,
  accountId: string,
  id: string,
): Promise<Member | null> {
  if (!v.is(householdId, id)) return null;
  // Nobody opens a closed household any more (ADR-0018 §2, clarification).
  const [member] = await inHousehold(context.db, id, (tx) =>
    tx
      .select({ id: members.id, role: members.role })
      .from(members)
      .innerJoin(households, eq(households.id, members.householdId))
      .where(and(eq(members.accountId, accountId), isNull(households.closedAt))),
  );
  if (!member) return null;
  const twoFactor = hasTwoFactors(await signInMethods(context.db, accountId));
  return { ...member, hasAccount: true, twoFactor };
}

/** A household of the signed-in account, as the list of them shows it. */
export interface AccountHousehold {
  id: string;
  name: string;
  /** The account's role in it. */
  role: Role;
}

/**
 * The households the signed-in account is a member of, by name: found before one is set, then each
 * read under its own row-level security (ADR-0008 §9, clarification). An account only ever lists
 * its own.
 */
export async function accountHouseholdList(
  context: HouseholdsContext,
  accountId: string,
): Promise<AccountHousehold[]> {
  const ids = await accountHouseholds(context.db, accountId);
  const list = await Promise.all(
    ids.map((id) =>
      inHousehold(context.db, id, async (tx) => {
        const [household] = await tx.select({ name: households.name }).from(households);
        const [member] = await tx
          .select({ role: members.role })
          .from(members)
          .where(eq(members.accountId, accountId));
        if (!household || !member) throw new Error('A household without the account in it.');
        return { id, name: household.name, role: member.role };
      }),
    ),
  );
  return list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Whether the account is a head of any of its households ("head" as ADR-0010 §3 means it). */
async function headAnywhere(context: HouseholdsContext, accountId: string) {
  return (await accountHouseholdList(context, accountId)).some(({ role }) => role === 'head');
}

/**
 * Whether the account may turn TOTP off: a head of any of its households must keep two factors,
 * so one without a passkey is refused (ADR-0010 §3). Its sign-in methods are read in `tx`, the
 * transaction that turns it off, once it holds the account's row.
 */
export async function mayTurnOffTwoFactor(
  context: HouseholdsContext,
  accountId: string,
  tx: Transaction,
): Promise<boolean> {
  const head = await headAnywhere(context, accountId);
  return mayTurnOffTotp(await signInMethods(tx, accountId), head);
}

/**
 * Whether the account may remove its passkey `passkeyId`: a head of any of its households must keep
 * two factors, so one left with neither another passkey nor a password with TOTP is refused
 * (ADR-0010 §3, clarification). Its sign-in methods are read in `tx`, the transaction that removes
 * it, once it holds the account's row.
 */
export async function mayRemoveAccountPasskey(
  context: HouseholdsContext,
  accountId: string,
  passkeyId: string,
  tx: Transaction,
): Promise<boolean> {
  const head = await headAnywhere(context, accountId);
  return mayRemovePasskey(await signInMethods(tx, accountId, passkeyId), head);
}

/** A member of the household, as the member viewing it sees them (ADR-0018 §3). */
export interface HouseholdMember {
  id: string;
  name: string;
  role: Role;
  /**
   * The account that accepted the profile's invitation, which heads see (ADR-0010 §1, §5,
   * clarification; ADR-0012 §3); null for the viewer themselves and for everyone else.
   */
  account: { name: string; email: string } | null;
  /** Whether the viewer may invite the profile: a head, for an adult without an account (§5). */
  invitable: boolean;
  /** When the profile's invitation link stops working, if it has one the viewer may see. */
  invitationExpiresAt: Temporal.Instant | null;
  /** Whether the viewer may remove them: a head, for anyone but a head (ADR-0018 §4). */
  removable: boolean;
}

type ViewHouseholdResult =
  | {
      ok: true;
      name: string;
      members: HouseholdMember[];
      /** Whether the member viewing it may add members: a head with two factors (ADR-0001 §2). */
      mayAddMembers: boolean;
      /** Whether they may leave it on their own: anyone but a child (ADR-0010 §10, ADR-0018 §2). */
      mayLeave: boolean;
      /** Whether they may change the household's settings, which only heads do (ADR-0007 §2). */
      mayChangeSettings: boolean;
      /** Whether they may start it: a head, while it is in setup (ADR-0007 §2 step 7). */
      mayStart: boolean;
      /**
       * If the household's last head named them head as they left, and they haven't said yet
       * whether they take it on: whether they may decline it, which the only adult with an account
       * can't (ADR-0018 §2, clarification). Null otherwise.
       */
      namedHead: { mayDecline: boolean } | null;
      /**
       * Whether they are a head who acts as head only once their account signs in with two factors,
       * and is asked to set them up (ADR-0010 §3, ADR-0018 §2).
       */
      needsTwoFactors: boolean;
      /**
       * Once it started on the week start day, until that first plan week begins: the week, and
       * when the heads see its draft and everyone its plan (ADR-0006 §2, ADR-0007 §3).
       */
      firstPlan: {
        week: Temporal.PlainDate;
        draftAt: Temporal.ZonedDateTime;
        publishAt: Temporal.ZonedDateTime;
      } | null;
    }
  | { ok: false; error: 'not-allowed' };

const roleOrder: Record<Role, number> = { head: 0, adult: 1, child: 2 };

/**
 * The household's name and its members, heads first, then adults and children, each by name
 * (ADR-0007 §1, ADR-0018 §3).
 */
export async function viewHousehold(context: HouseholdContext): Promise<ViewHouseholdResult> {
  if (!can(context.member, { action: 'household.view' }))
    return { ok: false, error: 'not-allowed' };
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const rows = await tx
      .select({
        id: members.id,
        name: members.name,
        role: members.role,
        accountName: accounts.name,
        email: accounts.email,
        invitationExpiresAt: invitations.expiresAt,
      })
      .from(members)
      .leftJoin(accounts, eq(accounts.id, members.accountId))
      .leftJoin(invitations, eq(invitations.memberId, members.id))
      .where(isCurrentMember);
    const mayInvite = can(context.member, { action: 'household.invite' });
    const now = context.clock.now();
    const list = rows.map((row): HouseholdMember => {
      const hasAccount = row.email !== null;
      const seen = { id: row.id, role: row.role, hasAccount, twoFactor: false };
      const others = row.id !== context.member.id;
      const account =
        others && row.accountName !== null && row.email !== null
          ? can(context.member, { action: 'email.view', member: seen })
            ? { name: row.accountName, email: row.email }
            : null
          : null;
      const invitable = mayInvite && row.role === 'adult' && !hasAccount;
      const expiresAt =
        invitable && row.invitationExpiresAt
          ? Temporal.Instant.fromEpochMilliseconds(row.invitationExpiresAt.getTime())
          : null;
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        account,
        invitable,
        // A link that has expired is as good as none.
        invitationExpiresAt:
          expiresAt && Temporal.Instant.compare(expiresAt, now) > 0 ? expiresAt : null,
        removable: can(context.member, { action: 'member.remove', member: seen }),
      };
    });
    list.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name));
    const mayChangeSettings = can(context.member, { action: 'household.settings' });
    const planning = await planningOf(tx);
    // Their role as it is now: answering the last head's naming may have just changed it.
    const [own] = await tx
      .select({ id: members.id, role: members.role, namedHead: members.namedHead })
      .from(members)
      .where(eq(members.id, context.member.id));
    const namedHead = own?.namedHead
      ? { mayDecline: !(await isLastHead(tx, own)) || (await successors(tx)).length > 0 }
      : null;
    return {
      ok: true as const,
      name: household.name,
      members: list,
      mayAddMembers: mayInvite,
      mayLeave: can(context.member, { action: 'member.leave', member: context.member }),
      mayChangeSettings,
      // Starting is a setting of the household's, which only heads change (ADR-0007 §2).
      mayStart: mayChangeSettings && !planning.firstWeek,
      namedHead,
      needsTwoFactors: own?.role === 'head' && !context.member.twoFactor,
      firstPlan: firstPlanOf(planning, context.clock.now()),
    };
  });
}

/**
 * The household's first plan, while its week is still to come at `now`: that week, and when the
 * scheduler drafts and publishes it (ADR-0006 §2, ADR-0007 §3). None in setup, nor once it began.
 */
function firstPlanOf({ calendar, timings, firstWeek }: Planning, now: Temporal.Instant) {
  const { timeZone } = calendar;
  if (!firstWeek || Temporal.PlainDate.compare(householdDate(now, timeZone), firstWeek) >= 0) {
    return null;
  }
  const times = comingPlanTimes(now, planWeek(firstWeek, calendar), calendar, timings);
  return {
    week: firstWeek,
    draftAt: times.draft.toZonedDateTimeISO(timeZone),
    publishAt: times.publish.toZonedDateTimeISO(timeZone),
  };
}
