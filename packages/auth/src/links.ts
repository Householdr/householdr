import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccountEmailKind } from '@householdr/db';

/** A link the library makes for an account e-mail: what it is for, and its token once made. */
export interface Link {
  purpose: AccountEmailKind;
  token?: string;
}

/**
 * The link being made in the current call. The library hands a new link's token to a callback of
 * its configuration rather than to whoever asked, so the asker waits for it here.
 */
export const linkInTheMaking = new AsyncLocalStorage<Link>();
