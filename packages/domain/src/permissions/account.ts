/** An account, as account-level permissions see it (ADR-0010 §6–§10). */
export interface Account {
  id: string;
  /**
   * A child's managed account, run by its guardians until the child takes it over (ADR-0010 §7).
   */
  managed: boolean;
  /** The accounts with parental responsibility for it; none for an adult (ADR-0010 §9). */
  guardians: readonly string[];
}

/** Whoever is signed in. */
export interface SignedIn {
  account: string;
  /** Guardian powers wait for two factors, like a head's (ADR-0010 §3). */
  twoFactor: boolean;
}

export type AccountAction =
  /**
   * See sessions and devices, approve a device, sign one out (ADR-0010 §4, §6–§7, ADR-0018 §2, §6).
   */
  | 'account.sessions'
  /**
   * E-mail, password, passkeys, two factors; a managed account only has passkeys (ADR-0010 §2–§3,
   * §7, ADR-0018 §2).
   */
  | 'account.signIn'
  /** ADR-0014 §3, ADR-0010 §7. */
  | 'account.notifications'
  /** Download the account's data (ADR-0012 §6, ADR-0018 §2). */
  | 'account.export'
  /** ADR-0010 §10, ADR-0012 §6, ADR-0018 §2. */
  | 'account.delete'
  /** Recover a managed account by approving a device again (ADR-0010 §8). */
  | 'account.recover'
  /** Invite another adult as co-guardian (ADR-0010 §9). */
  | 'guardian.invite'
  /** ADR-0010 §9, ADR-0018 §6. */
  | 'guardian.stepDown'
  /** Create a household, as its first head (ADR-0010 §1, ADR-0007 §2). */
  | 'household.create';

/**
 * Whether the signed-in account may act on `account` (ADR-0017 §2, ADR-0010 §9). These powers
 * belong to accounts, not households: a guardian acts for a child's managed account whatever
 * household the request is about, and nobody acts for another adult's account.
 */
export function canForAccount(who: SignedIn, action: AccountAction, account: Account): boolean {
  const self = who.account === account.id;
  const guardian = account.guardians.includes(who.account) && who.twoFactor;
  const forManaged = account.managed && guardian;
  switch (action) {
    case 'account.sessions':
      return self || forManaged;
    case 'account.signIn':
      return self;
    case 'account.notifications':
    case 'account.export':
    case 'account.delete':
      return account.managed ? forManaged : self;
    case 'account.recover':
    case 'guardian.invite':
      return forManaged;
    case 'guardian.stepDown':
      return account.guardians.includes(who.account);
    case 'household.create':
      // A head's account has two factors from the start, and a child's managed account creates
      // none (ADR-0010 §1, §3).
      return self && !account.managed && who.twoFactor;
  }
}
