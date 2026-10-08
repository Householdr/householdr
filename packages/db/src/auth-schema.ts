import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * What belongs to an account rather than a household, without row-level security: it is looked up
 * before anyone is known, by e-mail address or token (ADR-0008 §9, clarification). The tables follow
 * the authentication library's models, under our own names (ADR-0010).
 */
export const auth = pgSchema('auth');

// Set to UUIDs, the library leaves keys to the database: random ones, as everywhere (CODE-17).
const key = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** A person's account (ADR-0010 §1): the library's `user`. */
export const accounts = auth.table(
  'accounts',
  {
    id: key(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    /** The library's profile picture, which we never store (ADR-0012 §1). */
    image: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('accounts_no_image', sql`${t.image} is null`)],
);

/** A way to sign in to an account, such as a password (ADR-0010 §2): the library's `account`. */
export const credentials = auth.table(
  'credentials',
  {
    id: key(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    /** A slow hash, never the password itself (ADR-0010 §2). */
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('credentials_user').on(t.userId)],
);

/** A signed-in device (ADR-0010 §6). */
export const sessions = auth.table(
  'sessions',
  {
    id: key(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Always empty: a sign-in's address is kept in the security records only (ADR-0012 §2). */
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('sessions_user').on(t.userId),
    check('sessions_no_ip_address', sql`${t.ipAddress} is null`),
  ],
);

/** A pending check of an e-mail address or a reset, by a hashed identifier (SEC-7). */
export const verifications = auth.table(
  'verifications',
  {
    id: key(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier').on(t.identifier)],
);

/**
 * Counts for the rate limits of ADR-0017 §5, under a keyed hash of what they count, never an e-mail
 * or IP address (ADR-0012 §2, clarification). Unlogged: a crash empties it, which only starts the
 * counts again.
 */
export const rateLimits = auth.table(
  'rate_limits',
  {
    key: text().primaryKey(),
    /** Failures, and attempts not yet known to be failures; 0 when all were taken back. */
    count: integer().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull(),
    /** When the count is forgotten (ADR-0012 §5, clarification). */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index('rate_limits_expires_at').on(t.expiresAt),
    check('rate_limits_count', sql`${t.count} >= 0`),
  ],
);
