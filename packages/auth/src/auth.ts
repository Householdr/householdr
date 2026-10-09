import { passkey } from '@better-auth/passkey';
import {
  accounts,
  credentials,
  passkeys,
  sessions,
  twoFactors,
  verifications,
  type Database,
  type Transaction,
} from '@householdr/db';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { and, eq } from 'drizzle-orm';
import { deviceOf } from './device';
import { accountInTheMaking, linkInTheMaking, passwordResetInTheMaking } from './links';
import type { TotpKeys } from './totp-keys';

export interface AuthSettings {
  /** The database, or a transaction that everything the library writes joins. */
  db: Database | Transaction;
  /** The public URL people reach the app at, such as `https://householdr.example.org`. */
  baseUrl: string;
  /** Signs session cookies: at least 32 random bytes. */
  secret: string;
  /**
   * The keys that encrypt the secrets of authenticator apps and the recovery codes (ADR-0017 §7).
   * Absent where nothing reads or writes those, such as in the worker: the library then can't.
   */
  totpKeys?: TotpKeys;
}

/** A day in seconds, the unit the library takes session lifetimes in. */
const day = 24 * 60 * 60;

/**
 * How recent a sign-in must be to change a way of signing in; an older one confirms it is still
 * the same person by signing in again (ADR-0010 §6).
 */
export const recentSignIn = Temporal.Duration.from({ minutes: 10 });

/**
 * Has the library encrypt with the versioned TOTP keys rather than with the session secret, which it
 * would use otherwise (ADR-0012 §4, ADR-0017 §7): a key can then be rotated without locking anyone
 * out of their second factor or signing anyone out. Of the library's features this app uses, only
 * the two-factor plugin encrypts anything.
 */
function totpEncryption(keys: TotpKeys | undefined) {
  return {
    id: 'totp-encryption',
    init: () => ({
      context: {
        secretConfig: {
          keys: new Map(keys?.keys),
          // Without keys, no version is current, so encrypting fails rather than falling back.
          currentVersion: keys?.current ?? -1,
          legacySecret: undefined,
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}

/**
 * The authentication library over the `auth` tables (ADR-0008 §9 and ADR-0023 §2,
 * clarifications). Sign-in methods are added by the features that offer them (ADR-0010 §2).
 */
export function createAuth({ db, baseUrl, secret, totpKeys }: AuthSettings) {
  return betterAuth({
    appName: 'Householdr',
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: accounts,
        account: credentials,
        session: sessions,
        verification: verifications,
        passkey: passkeys,
        twoFactor: twoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // At least 12 characters, and no rules about what they are (ADR-0010 §2).
      minPasswordLength: 12,
      // Accounts are made from a confirmed address; one that isn't confirmed can't sign in.
      requireEmailVerification: true,
      // A reset link lasts 30 minutes (ADR-0010 §8). The worker sends it, so the library only
      // hands its token over (ADR-0014 §7, clarification).
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: ({ token }) => {
        const link = linkInTheMaking.getStore();
        if (link) link.token = token;
        return Promise.resolve();
      },
      // Every recovery ends all sessions (ADR-0010 §8).
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: ({ user }) => {
        const reset = passwordResetInTheMaking.getStore();
        if (reset) reset.account = { id: user.id, email: user.email };
        return Promise.resolve();
      },
    },
    user: {
      // Every account has a culture (ADR-0008 §6), also those the library makes.
      additionalFields: { culture: { type: 'string', required: true, input: false } },
    },
    session: {
      // A session lasts 30 days and is extended while used (ADR-0010 §6).
      expiresIn: 30 * day,
      updateAge: day,
      freshAge: recentSignIn.total('seconds'),
      // The device it was started on, for the security page (ADR-0010 §6).
      additionalFields: {
        browser: { type: 'string', required: false, input: false },
        system: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      // Random UUID keys, like every other table (CODE-17).
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
      // `__Host-` cookies (ADR-0017 §4). The library's own secure setting would name them
      // `__Secure-`, so the prefix and attributes are set here instead.
      useSecureCookies: false,
      cookiePrefix: '__Host-householdr',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    },
    databaseHooks: {
      // A link made for an account e-mail replaces the older ones for the same purpose and account
      // (ADR-0014 §7, clarification), and is marked with its purpose to be found the next time.
      verification: {
        create: {
          before: async (verification) => {
            const link = linkInTheMaking.getStore();
            if (!link) return;
            await db
              .delete(verifications)
              .where(
                and(
                  eq(verifications.purpose, link.purpose),
                  eq(verifications.value, verification.value),
                ),
              );
            return { data: { ...verification, purpose: link.purpose } };
          },
        },
      },
      // Without tracking the library still writes an empty address; a session keeps none, and of
      // the user agent only the browser's and system's names. The database refuses the rest
      // (ADR-0012 §2, clarification). A session the library makes in place of another, such as
      // when two-factor is turned on, has no user agent of its own and keeps the names it took over.
      session: {
        create: {
          before: (session) =>
            Promise.resolve({
              data: {
                ...session,
                ...(session.userAgent ? deviceOf(session.userAgent) : {}),
                ipAddress: null,
                userAgent: null,
              },
            }),
        },
      },
    },
    // Tokens and codes are looked up by their hash, never stored as they are (SEC-7).
    verification: {
      storeIdentifier: 'hashed',
      additionalFields: { purpose: { type: 'string', required: false, input: false } },
    },
    plugins: [
      // Passkeys for this site only, checked against its own address rather than the one a request
      // says it comes from (ADR-0010 §2).
      passkey({
        rpID: new URL(baseUrl).hostname,
        rpName: 'Householdr',
        origin: new URL(baseUrl).origin,
        // Signing up makes the account's first passkey before the account exists (ADR-0010 §1, §3,
        // clarification). Anywhere else a passkey needs the session of its account; how recent
        // that sign-in must be, `passkeys.ts` checks (§6).
        registration: {
          requireSession: false,
          resolveUser: () => {
            const account = accountInTheMaking.getStore();
            if (!account) throw new APIError('UNAUTHORIZED');
            // The account's id, chosen now, and its address, which password managers show.
            return { id: crypto.randomUUID(), name: account.email, displayName: account.email };
          },
          afterVerification: async ({ ctx, user }) => {
            const account = accountInTheMaking.getStore();
            if (!account) {
              const session = await getSessionFromCtx(ctx);
              if (session?.user.id !== user.id) throw new APIError('UNAUTHORIZED');
              return;
            }
            // Made for this address, and written before the passkey and the session that need it.
            if (user.name !== account.email || !account.write || !(await account.write(user.id))) {
              throw new APIError('BAD_REQUEST');
            }
          },
        },
      }),
      // Codes from an authenticator app after the password, with ten recovery codes (ADR-0010
      // §2). A password sign-in of an account that has them on leaves no session, only a step that
      // waits for a code for 10 minutes; a passkey sign-in never asks for one.
      twoFactor({
        issuer: 'Householdr',
        twoFactorCookieMaxAge: 10 * 60,
        // Wrong codes make the next attempt wait instead, counted per account (ADR-0010 §2,
        // clarification): the library's lock-out would let anyone who knows the password lock
        // the person whose account it is out.
        accountLockout: { enabled: false },
      }),
      totpEncryption(totpKeys),
    ],
    // Nothing leaves the server, on our hosting or a self-hosted one (SEC-13).
    telemetry: { enabled: false },
    // At `info`, the library logs e-mail addresses (SEC-3).
    logger: { level: 'warn' },
  });
}

export type Auth = ReturnType<typeof createAuth>;
