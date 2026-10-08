import { accounts, credentials, sessions, verifications, type Database } from '@householdr/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export interface AuthSettings {
  db: Database;
  /** The public URL people reach the app at, such as `https://householdr.example.org`. */
  baseUrl: string;
  /** Signs session cookies: at least 32 random bytes. */
  secret: string;
}

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
    advanced: {
      // Random UUID keys, like every other table (CODE-17).
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      // Without tracking the library still writes an empty address; a session keeps none, and the
      // database refuses one (ADR-0012 §2, clarification).
      session: {
        create: { before: (session) => Promise.resolve({ data: { ...session, ipAddress: null } }) },
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
