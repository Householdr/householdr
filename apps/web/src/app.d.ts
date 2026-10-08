import type { FlagKey } from '@householdr/application';

declare global {
  namespace App {
    interface Locals {
      /** Every flag, evaluated once for this request (ADR-0015 §3). */
      flags: Record<FlagKey, boolean>;
    }
  }
}

export {};
