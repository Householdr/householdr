/** A member's role in a household (ADR-0001 §1). */
export type Role = 'head' | 'adult' | 'child';

/** A member of the household, as the permission matrix sees them (ADR-0017 §2). */
export interface Member {
  id: string;
  role: Role;
  /** A profile without an account can't act for itself (ADR-0018 §4). */
  hasAccount: boolean;
  /** Head powers wait until the account signs in with two factors (ADR-0010 §3). */
  twoFactor: boolean;
}

/** What a member may do to another member, or to themselves. */
export type MemberAction =
  /**
   * See their availability in full and edit it; others see away dates (ADR-0005 §2, ADR-0018
   * §3–§4).
   */
  | 'availability.manage'
  /** ADR-0018 §4. */
  | 'share.view'
  /** ADR-0001 §4, ADR-0018 §4. */
  | 'share.edit'
  /** ADR-0012 §3. */
  | 'email.view'
  /** Burden estimates and answers (ADR-0003 §5). */
  | 'burdens.view'
  /** Exact completion times; fixed-window tasks show theirs to everyone (ADR-0018 §3). */
  | 'exactTimes.view'
  /** ADR-0001 §2, ADR-0018 §4, ADR-0010 §10. */
  | 'member.remove'
  /** ADR-0018 §2, ADR-0010 §10. */
  | 'member.leave'
  /** Propose as head; the member accepts (ADR-0010 §3). */
  | 'member.promote'
  /** ADR-0018 §4. */
  | 'member.stepDown'
  /** ADR-0012 §6. */
  | 'profile.name'
  /** Role and a child's birth date (ADR-0012 §6). */
  | 'profile.details'
  /** ADR-0012 §6. */
  | 'profile.delete'
  /** ADR-0010 §5, ADR-0018 §4. */
  | 'account.unlink'
  /** Turn approval of their completions on or off (ADR-0006 §4). */
  | 'approval.configure'
  /** ADR-0006 §4, clarification. */
  | 'completion.approve'
  /** Play the comparison game as them (ADR-0003 §3, ADR-0007 §4). */
  | 'comparison.play'
  /** Propose, answer and pick up as them (ADR-0002 §4–§5, clarification). */
  | 'swaps.act'
  /** Log a completion done by them (ADR-0006 §4). */
  | 'completion.log';

/** What a member wants to do, with what it is about. */
export type Permission =
  /**
   * Name, time zone, language, country, week start, plan timings, rebalance rate (ADR-0001 §1–§2,
   * ADR-0002 §3, ADR-0007 §2).
   */
  | { action: 'household.settings' }
  /** ADR-0005 §5, ADR-0006 §2 clarification. */
  | { action: 'household.away' }
  /** Start, confirm or undo the household's deletion (ADR-0012 §6). */
  | { action: 'household.delete' }
  /**
   * Tasks, schedules, areas, constraints, baseline burdens, minimum ages (ADR-0001 §1–§3, ADR-0003
   * §3).
   */
  | { action: 'household.tasks' }
  /** Create profiles and invitations (ADR-0001 §2, ADR-0010 §5). */
  | { action: 'household.invite' }
  /**
   * Published plans, completions, balances, history, the activity log (ADR-0002 §6, ADR-0018 §5).
   */
  | { action: 'household.view' }
  /** See and change the draft, re-run the allocator, publish early (ADR-0006 §2). */
  | { action: 'plan.draft' }
  /** Move an occurrence after publishing (ADR-0006 §3). */
  | { action: 'plan.reassign' }
  /** ADR-0002 §7, ADR-0006 §4. */
  | { action: 'ledger.correct' }
  /** ADR-0006 §3, clarification. */
  | { action: 'oneOff.add' }
  | { action: 'oneOff.edit'; addedBy: string; done: boolean }
  | {
      action: 'completion.undo';
      loggedBy: string;
      credited: readonly string[];
      inPlanWeek: boolean;
    }
  | { action: MemberAction; member: Member };

const headOnly = new Set<Permission['action']>([
  'household.settings',
  'household.away',
  'household.delete',
  'household.tasks',
  'household.invite',
  'plan.draft',
  'plan.reassign',
  'ledger.correct',
]);

/**
 * Whether `actor` may do something in their household (ADR-0017 §2, ADR-0018 §4, ADR-0010). Deny by
 * default: only members with an account act, and head powers need two factors.
 */
export function can(actor: Member, permission: Permission): boolean {
  if (!actor.hasAccount) return false;
  const head = actor.role === 'head' && actor.twoFactor;
  if (headOnly.has(permission.action)) return head;
  switch (permission.action) {
    case 'household.view':
    case 'oneOff.add':
      return true;
    case 'oneOff.edit':
      return head || (permission.addedBy === actor.id && !permission.done);
    case 'completion.undo':
      return (
        permission.inPlanWeek &&
        (head || permission.loggedBy === actor.id || permission.credited.includes(actor.id))
      );
  }
  return 'member' in permission && canFor(actor, head, permission.action, permission.member);
}

function canFor(actor: Member, head: boolean, action: MemberAction, member: Member): boolean {
  const self = member.id === actor.id;
  const child = member.role === 'child';
  const profile = !member.hasAccount;
  switch (action) {
    case 'availability.manage':
      return self || (head && (child || profile));
    case 'share.view':
    case 'email.view':
      return self || head;
    case 'share.edit':
      return head;
    case 'burdens.view':
    case 'exactTimes.view':
      return self;
    case 'member.remove':
      return head && !self && member.role !== 'head';
    case 'member.leave':
      return self && !child;
    case 'member.promote':
      return head && member.role === 'adult' && member.hasAccount;
    case 'member.stepDown':
      return self && actor.role === 'head';
    case 'profile.name':
      return self || (head && profile);
    case 'profile.details':
      return head && (child || profile);
    case 'profile.delete':
      return head && profile;
    case 'account.unlink':
      return head && member.hasAccount && member.role !== 'head';
    case 'approval.configure':
    case 'completion.approve':
      return head && child;
    case 'comparison.play':
      return self || (head && child && profile);
    case 'swaps.act':
      return self || (head && profile);
    case 'completion.log':
      return true;
  }
}
