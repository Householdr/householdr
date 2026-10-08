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
  type AnyPgColumn,
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
    /**
     * The language the person reads the app in and the country whose conventions they see, as a
     * BCP 47 tag such as `nl-BE` (ADR-0008 §6).
     */
    culture: text().notNull(),
    /**
     * The version of the instance's terms the person accepted, and when; neither on an instance
     * without terms (ADR-0012 §2, clarification).
     */
    termsVersion: text(),
    termsAcceptedAt: timestamp({ withTimezone: true }),
    /**
     * Whether signing in with the password also asks for a code from an authenticator app
     * (ADR-0010 §2): the library's `twoFactorEnabled`, set once the first code was right.
     */
    twoFactorEnabled: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('accounts_no_image', sql`${t.image} is null`),
    check('accounts_culture', sql`${t.culture} ~ '^[a-z]{2,3}-[A-Z]{2}$'`),
    // Both or neither. Both sides are true or false, never null, which a check would let through.
    check(
      'accounts_terms',
      sql`(${t.termsVersion} is null and ${t.termsAcceptedAt} is null)
        or (${t.termsVersion} is not null and ${t.termsAcceptedAt} is not null)`,
    ),
  ],
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
    /** Always empty: of the user agent, only the names below are kept (ADR-0012 §2, clarification). */
    userAgent: text(),
    /** The browser and operating system the session was started on, by name (ADR-0010 §6). */
    browser: text(),
    system: text(),
    userId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('sessions_user').on(t.userId),
    check('sessions_no_ip_address', sql`${t.ipAddress} is null`),
    check('sessions_no_user_agent', sql`${t.userAgent} is null`),
  ],
);

/**
 * A passkey of an account (ADR-0010 §2): the library's `passkey`. It holds the credential's public
 * key, never anything secret (ADR-0012 §2).
 */
export const passkeys = auth.table(
  'passkeys',
  {
    id: key(),
    /** The library's name for a passkey, which we leave empty: it is named after its device. */
    name: text(),
    /** The browser and operating system it was added on, by name (ADR-0010 §2). */
    browser: text(),
    system: text(),
    publicKey: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    credentialID: text().notNull().unique(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: boolean().notNull(),
    transports: text(),
    createdAt: createdAt(),
    aaguid: text(),
  },
  (t) => [index('passkeys_user').on(t.userId), check('passkeys_no_name', sql`${t.name} is null`)],
);

/** What the library writes in front of what it encrypted, with the version of the key it used. */
const encrypted = (column: AnyPgColumn) => sql`${column} like '$ba$%'`;

/**
 * The authenticator app of an account with a password, and its recovery codes (ADR-0010 §2): the
 * library's `twoFactor`. Both are encrypted in the application with a versioned key before they
 * reach the database, never stored as they are (ADR-0012 §4, ADR-0017 §7).
 */
export const twoFactors = auth.table(
  'two_factors',
  {
    id: key(),
    /** The shared secret of the authenticator app, encrypted. */
    secret: text().notNull(),
    /** The recovery codes not used yet, encrypted together; each works once. */
    backupCodes: text().notNull(),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** False while being set up: until the first code from the app was right. */
    verified: boolean().notNull().default(false),
    /**
     * The library's own lock-out, which is off: wrong codes make the next attempt wait instead
     * (ADR-0010 §2, clarification). So these stay 0 and empty.
     */
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('two_factors_secret_encrypted', encrypted(t.secret)),
    check('two_factors_backup_codes_encrypted', encrypted(t.backupCodes)),
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
    /**
     * What an e-mailed link is for, so a newer link replaces the older one; the hashed identifier
     * can't tell (ADR-0014 §7, clarification). Empty for the library's other checks.
     */
    purpose: text().$type<LinkKind>(),
  },
  (t) => [
    index('verifications_identifier').on(t.identifier),
    index('verifications_purpose').on(t.purpose, t.value),
    check('verifications_purpose', sql`${t.purpose} in ('password-reset', 'sign-up')`),
  ],
);

/** The account e-mails there are (ADR-0014 §2). */
export type AccountEmailKind =
  | 'sign-up'
  | 'password-reset'
  | 'password-changed'
  | 'passkey-added'
  | 'passkey-removed'
  | 'two-factor-on'
  | 'two-factor-off'
  | 'recovery-codes-changed';

/** The account e-mails with a token link, which `auth.verifications` marks by purpose. */
export type LinkKind = Extract<AccountEmailKind, 'sign-up' | 'password-reset'>;

/**
 * An account e-mail waiting to be sent: deleted once it is, and holding nothing the e-mail can't
 * be made from again (ADR-0014 §7, clarification). It goes to an account, or for a sign-up, to
 * the address typed, which has none yet (ADR-0010 §1, clarification).
 */
export const accountEmails = auth.table(
  'account_emails',
  {
    id: key(),
    kind: text().$type<AccountEmailKind>().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }),
    email: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'account_emails_kind',
      sql`${t.kind} in ('sign-up', 'password-reset', 'password-changed', 'passkey-added', 'passkey-removed', 'two-factor-on', 'two-factor-off', 'recovery-codes-changed')`,
    ),
    // A sign-up's goes to an address, every other one to an account. Both sides are true or false,
    // never null, which a check would let through.
    check(
      'account_emails_recipient',
      sql`(${t.kind} = 'sign-up' and ${t.accountId} is null and ${t.email} is not null)
        or (${t.kind} <> 'sign-up' and ${t.accountId} is not null and ${t.email} is null)`,
    ),
  ],
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
