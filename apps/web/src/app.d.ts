import type { FlagKey } from '@householdr/application';
import type { Session } from '@householdr/auth';

declare global {
  namespace App {
    interface Locals {
      /** Every flag, evaluated once for this request (ADR-0015 §3). */
      flags: Record<FlagKey, boolean>;
      /** Who the request is signed in as, if anyone (ADR-0010 §6). */
      session: Session | null;
    }
  }
}

export {};
