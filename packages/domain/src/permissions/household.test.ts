import { describe, expect, it } from 'vitest';
import { can, type Member, type MemberAction, type Permission, type Role } from './household';

// The permission matrix, exhaustively (ADR-0017 §2 and §5): every action, for every kind of actor,
// on every kind of member. "Y" allows, "." denies.

const member = (id: string, role: Role, hasAccount: boolean, twoFactor: boolean): Member => ({
  id,
  role,
  hasAccount,
  twoFactor,
});

const actors = {
  head: member('me', 'head', true, true),
  /** A head whose account doesn't have two factors yet (ADR-0010 §3). */
  pendingHead: member('me', 'head', true, false),
  adult: member('me', 'adult', true, true),
  child: member('me', 'child', true, false),
};
type ActorKind = keyof typeof actors;

// Columns: the actor themselves, another head, an adult, an adult's profile without an account,
// a child with an account, a child's profile without an account.
const others = [
  member('head', 'head', true, true),
  member('adult', 'adult', true, true),
  member('adult-profile', 'adult', false, false),
  member('child', 'child', true, false),
  member('child-profile', 'child', false, false),
];
const row = (actor: Member, action: MemberAction) =>
  [actor, ...others].map((m) => (can(actor, { action, member: m }) ? 'Y' : '.')).join('');

const memberMatrix: Record<MemberAction, Record<ActorKind, string>> = {
  // ADR-0005 §2, ADR-0018 §3–§4, ADR-0010 §7.
  'availability.manage': {
    head: 'Y..YYY',
    pendingHead: 'Y.....',
    adult: 'Y.....',
    child: 'Y.....',
  },
  // ADR-0018 §4.
  'share.view': { head: 'YYYYYY', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // ADR-0001 §4; their own included (ADR-0018 §4).
  'share.edit': { head: 'YYYYYY', pendingHead: '......', adult: '......', child: '......' },
  // ADR-0012 §3.
  'email.view': { head: 'YYYYYY', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // ADR-0003 §5, ADR-0018 §4, also for children.
  'burdens.view': { head: 'Y.....', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // ADR-0018 §3–§4.
  'exactTimes.view': { head: 'Y.....', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // Not themselves (that's leaving) and not another head (ADR-0018 §4).
  'member.remove': { head: '..YYYY', pendingHead: '......', adult: '......', child: '......' },
  // A child can't leave alone (ADR-0010 §10).
  'member.leave': { head: 'Y.....', pendingHead: 'Y.....', adult: 'Y.....', child: '......' },
  // Adults with an account only, who then accept (ADR-0010 §3).
  'member.promote': { head: '..Y...', pendingHead: '......', adult: '......', child: '......' },
  // ADR-0018 §4.
  'member.stepDown': { head: 'Y.....', pendingHead: 'Y.....', adult: '......', child: '......' },
  // Their own name; heads for profiles without an account (ADR-0012 §6).
  'profile.name': { head: 'Y..Y.Y', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // Children's details and unlinked profiles; never an adult with an account (ADR-0012 §6).
  'profile.details': { head: '...YYY', pendingHead: '......', adult: '......', child: '......' },
  'profile.delete': { head: '...Y.Y', pendingHead: '......', adult: '......', child: '......' },
  // Never another head (ADR-0010 §5, ADR-0018 §4).
  'account.unlink': { head: '..Y.Y.', pendingHead: '......', adult: '......', child: '......' },
  // ADR-0006 §4.
  'approval.configure': { head: '....YY', pendingHead: '......', adult: '......', child: '......' },
  'completion.approve': { head: '....YY', pendingHead: '......', adult: '......', child: '......' },
  // ADR-0003 §3, ADR-0007 §4.
  'comparison.play': { head: 'Y....Y', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // ADR-0002 §4–§5, clarification.
  'swaps.act': { head: 'Y..Y.Y', pendingHead: 'Y.....', adult: 'Y.....', child: 'Y.....' },
  // "By anyone on their behalf" (ADR-0006 §4).
  'completion.log': { head: 'YYYYYY', pendingHead: 'YYYYYY', adult: 'YYYYYY', child: 'YYYYYY' },
};

// Columns: head, pending head, adult, child.
const householdMatrix: Record<string, string> = {
  'household.settings': 'Y...',
  'household.away': 'Y...',
  'household.delete': 'Y...',
  'household.tasks': 'Y...',
  'household.invite': 'Y...',
  'plan.draft': 'Y...',
  'plan.reassign': 'Y...',
  'ledger.correct': 'Y...',
  'household.view': 'YYYY',
  'oneOff.add': 'YYYY',
};

describe('can, for actions on a member (ADR-0017 §2)', () => {
  for (const [action, rows] of Object.entries(memberMatrix)) {
    it(action, () => {
      for (const [kind, expected] of Object.entries(rows)) {
        expect([kind, row(actors[kind as ActorKind], action as MemberAction)]).toEqual([
          kind,
          expected,
        ]);
      }
    });
  }
});

describe('can, for the household (ADR-0017 §2)', () => {
  for (const [action, expected] of Object.entries(householdMatrix)) {
    it(action, () => {
      const permission = { action } as Permission;
      const got = Object.values(actors)
        .map((actor) => (can(actor, permission) ? 'Y' : '.'))
        .join('');
      expect(got).toBe(expected);
    });
  }
});

describe('can, for one-off tasks (ADR-0006 §3, clarification)', () => {
  const edit = (addedBy: string, done: boolean): Permission => ({
    action: 'oneOff.edit',
    addedBy,
    done,
  });

  it('lets the member who added it change it until it is done', () => {
    expect(can(actors.child, edit('me', false))).toBe(true);
    expect(can(actors.child, edit('me', true))).toBe(false);
    expect(can(actors.adult, edit('someone-else', false))).toBe(false);
  });

  it('lets heads change any one-off task', () => {
    expect(can(actors.head, edit('someone-else', true))).toBe(true);
    expect(can(actors.pendingHead, edit('someone-else', false))).toBe(false);
  });
});

describe('can, for undoing a completion (ADR-0006 §4, clarification)', () => {
  const undo = (loggedBy: string, credited: string[], inPlanWeek = true): Permission => ({
    action: 'completion.undo',
    loggedBy,
    credited,
    inPlanWeek,
  });

  it('lets the logger, anyone credited, or a head undo it within the plan week', () => {
    expect(can(actors.child, undo('me', ['other']))).toBe(true);
    expect(can(actors.child, undo('other', ['other', 'me']))).toBe(true);
    expect(can(actors.head, undo('other', ['other']))).toBe(true);
    expect(can(actors.adult, undo('other', ['other']))).toBe(false);
  });

  it('lets nobody undo it after the plan week, when a head corrects the ledger instead', () => {
    expect(can(actors.head, undo('me', ['me'], false))).toBe(false);
  });
});

describe('can, for a profile without an account (ADR-0018 §4)', () => {
  it('never lets it act', () => {
    const profile = member('me', 'head', false, true);
    const permissions: Permission[] = [
      ...Object.keys(householdMatrix).map((action) => ({ action }) as Permission),
      ...Object.keys(memberMatrix).flatMap((action) =>
        [profile, ...others].map((m) => ({ action: action as MemberAction, member: m })),
      ),
    ];
    for (const permission of permissions) expect(can(profile, permission)).toBe(false);
  });
});
