import type { FlagKey, Member } from '@householdr/application';
import type { Session } from '@householdr/auth';

declare global {
  namespace App {
    interface Locals {
      /** Every flag, evaluated once for this request (ADR-0015 §3). */
      flags: Record<FlagKey, boolean>;
      /** Who the request is signed in as, if anyone (ADR-0010 §6). */
      session: Session | null;
      /**
       * The household the request is about, and the member the signed-in account is in it, which
       * the guard checked (ADR-0017 §2); null on routes outside a household.
       */
      membership: { householdId: string; member: Member } | null;
    }
  }
}

export {};
