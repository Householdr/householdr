import { AsyncLocalStorage } from 'node:async_hooks';
import type { LinkKind } from '@householdr/db';

/** A link the library makes for an account e-mail: what it is for, and its token once made. */
export interface Link {
  purpose: LinkKind;
  token?: string;
}

/**
 * The link being made in the current call. The library hands a new link's token to a callback of
 * its configuration rather than to whoever asked, so the asker waits for it here.
 */
export const linkInTheMaking = new AsyncLocalStorage<Link>();

/**
 * How the library's table knows a link to sign up by its token: by this, hashed (SEC-7), apart from
 * the reset links it makes itself.
 */
export const signUpLinkId = (token: string) => `sign-up:${token}`;

/**
 * The account that signing up with a passkey creates, with the household it creates (ADR-0010 §1,
 * clarification). The library asks a callback of its configuration whom a passkey is for, and
 * hands the verified passkey to another before writing it, so both wait for the account here.
 */
export interface AccountInTheMaking {
  /** The confirmed address of the sign-up link the account is created from. */
  email: string;
  /**
   * Writes the account, with `id`, in the transaction that creates it; false if the address has an
   * account by now. Absent while only the passkey's options are made.
   */
  write?: (id: string) => Promise<boolean>;
}

/**
 * The account in the making in the current call, if any: outside signing up, a passkey is only
 * ever added to the account signed in.
 */
export const accountInTheMaking = new AsyncLocalStorage<AccountInTheMaking>();

/**
 * The account whose password the current call reset. The library reports it to a callback of its
 * configuration rather than to whoever asked, so the asker waits for it here.
 */
export const passwordResetInTheMaking = new AsyncLocalStorage<{
  account?: { id: string; email: string };
}>();
