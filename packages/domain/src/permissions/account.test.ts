import { describe, expect, it } from 'vitest';
import { canForAccount, type Account, type AccountAction, type SignedIn } from './account';

// Account-level permissions, exhaustively (ADR-0017 §2 and §5). "Y" allows, "." denies.

const who: Record<'guardian' | 'pendingGuardian' | 'stranger', SignedIn> = {
  guardian: { account: 'g', twoFactor: true },
  /** A guardian whose account doesn't have two factors yet (ADR-0010 §3). */
  pendingGuardian: { account: 'g', twoFactor: false },
  stranger: { account: 's', twoFactor: true },
};
type Who = keyof typeof who;

// Columns: their own account, another adult's, a managed child's they're guardian of, and that
// child's after taking it over (ADR-0010 §7).
const accounts = (self: string): Account[] => [
  { id: self, managed: false, guardians: [] },
  { id: 'adult', managed: false, guardians: [] },
  { id: 'managed', managed: true, guardians: ['g'] },
  { id: 'grown', managed: false, guardians: ['g'] },
];
const row = (signedIn: SignedIn, action: AccountAction) =>
  accounts(signedIn.account)
    .map((account) => (canForAccount(signedIn, action, account) ? 'Y' : '.'))
    .join('');

const matrix: Record<AccountAction, Record<Who, string>> = {
  // ADR-0010 §6–§7, ADR-0018 §2, §6; guardians step back at take-over.
  'account.sessions': { guardian: 'Y.Y.', pendingGuardian: 'Y...', stranger: 'Y...' },
  // Nobody changes another account's sign-in (ADR-0018 §2).
  'account.signIn': { guardian: 'Y...', pendingGuardian: 'Y...', stranger: 'Y...' },
  // ADR-0014 §3, ADR-0010 §7.
  'account.notifications': { guardian: 'Y.Y.', pendingGuardian: 'Y...', stranger: 'Y...' },
  // ADR-0012 §6, ADR-0010 §10.
  'account.export': { guardian: 'Y.Y.', pendingGuardian: 'Y...', stranger: 'Y...' },
  'account.delete': { guardian: 'Y.Y.', pendingGuardian: 'Y...', stranger: 'Y...' },
  // ADR-0010 §8.
  'account.recover': { guardian: '..Y.', pendingGuardian: '....', stranger: '....' },
  // ADR-0010 §9.
  'guardian.invite': { guardian: '..Y.', pendingGuardian: '....', stranger: '....' },
  // Any guardian can always step down (ADR-0018 §6).
  'guardian.stepDown': { guardian: '..YY', pendingGuardian: '..YY', stranger: '....' },
};

describe('canForAccount (ADR-0017 §2, ADR-0010 §9)', () => {
  for (const [action, rows] of Object.entries(matrix)) {
    it(action, () => {
      for (const [kind, expected] of Object.entries(rows)) {
        expect([kind, row(who[kind as Who], action as AccountAction)]).toEqual([kind, expected]);
      }
    });
  }

  it("leaves a managed account's own settings and data to its guardians", () => {
    const child: SignedIn = { account: 'managed', twoFactor: false };
    const own: Account = { id: 'managed', managed: true, guardians: ['g'] };
    const allowed = (Object.keys(matrix) as AccountAction[]).filter((action) =>
      canForAccount(child, action, own),
    );
    expect(allowed).toEqual(['account.sessions', 'account.signIn']);
  });
});
