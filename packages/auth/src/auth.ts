import { accounts, credentials, sessions, verifications, type Database } from '@householdr/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { deviceOf } from './device';

export interface AuthSettings {
  db: Database;
  /** The public URL people reach the app at, such as `https://householdr.example.org`. */
  baseUrl: string;
  /** Signs session cookies: at least 32 random bytes. */
  secret: string;
}

/** A day in seconds, the unit the library takes session lifetimes in. */
const day = 24 * 60 * 60;

/**
 * The authentication library over the `auth` tables (ADR-0008 §9 and ADR-0023 §2,
 * clarifications). Sign-in methods are added by the features that offer them (ADR-0010 §2).
 */
export function createAuth({ db, baseUrl, secret }: AuthSettings) {
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
      },
    }),
    emailAndPassword: {
      enabled: true,
      // At least 12 characters, and no rules about what they are (ADR-0010 §2).
      minPasswordLength: 12,
      // Accounts are made from a confirmed address; one that isn't confirmed can't sign in.
      requireEmailVerification: true,
    },
    session: {
      // A session lasts 30 days and is extended while used (ADR-0010 §6).
      expiresIn: 30 * day,
      updateAge: day,
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
      // Without tracking the library still writes an empty address; a session keeps none, and of
      // the user agent only the browser's and system's names. The database refuses the rest
      // (ADR-0012 §2, clarification).
      session: {
        create: {
          before: (session) =>
            Promise.resolve({
              data: {
                ...session,
                ...deviceOf(session.userAgent),
                ipAddress: null,
                userAgent: null,
              },
            }),
        },
      },
    },
    // Tokens and codes are looked up by their hash, never stored as they are (SEC-7).
    verification: { storeIdentifier: 'hashed' },
    // Nothing leaves the server, on our hosting or a self-hosted one (SEC-13).
    telemetry: { enabled: false },
    // At `info`, the library logs e-mail addresses (SEC-3).
    logger: { level: 'warn' },
  });
}

export type Auth = ReturnType<typeof createAuth>;
