import { sql, type AnyColumn } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The household a transaction works in: set by `inHousehold`, empty otherwise, so that without it
 * row-level security shows and accepts nothing (ADR-0008 §9, CODE-17).
 */
const currentHousehold = sql`nullif(current_setting('householdr.household_id', true), '')::uuid`;

/** Rows of `column`'s household only, for reading and for writing (ADR-0008 §9, CODE-17). */
function householdOnly(column: AnyColumn) {
  const own = sql`${column} = ${currentHousehold}`;
  return pgPolicy('household_only', { for: 'all', using: own, withCheck: own });
}

/** A household and its settings (ADR-0006 §1, ADR-0007 §2). */
export const households = pgTable(
  'households',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** ISO 3166-1 alpha-2, such as `BE`: sets the consent age (ADR-0010 §9). */
    country: text().notNull(),
    /** An offered language, such as `nl` (ADR-0016 §1). */
    language: text().notNull(),
    /** An IANA time zone, such as `Europe/Brussels`. */
    timeZone: text().notNull(),
    /** 1 is Monday, 7 is Sunday. */
    weekStartDay: smallint().notNull(),
    /** The latest change of start day: weeks before this date start on `weekStartPreviousDay`. */
    weekStartChangeFrom: date(),
    weekStartPreviousDay: smallint(),
    /** For versioned updates (ADR-0019 §5). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.id),
    check('households_name', sql`${t.name} <> ''`),
    check('households_country', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('households_language', sql`${t.language} ~ '^[a-z]{2,3}$'`),
    check('households_time_zone', sql`${t.timeZone} <> ''`),
    check('households_week_start_day', sql`${t.weekStartDay} between 1 and 7`),
    // A change of start day has both its date and its previous day, which differs from the current
    // one and is the weekday of the date (ADR-0006 §1, clarification). Both sides are true or false,
    // never null, which a check would let through.
    check(
      'households_week_start_change',
      sql`(${t.weekStartChangeFrom} is null and ${t.weekStartPreviousDay} is null)
        or (${t.weekStartChangeFrom} is not null and ${t.weekStartPreviousDay} is not null
          and ${t.weekStartPreviousDay} <> ${t.weekStartDay}
          and extract(isodow from ${t.weekStartChangeFrom}) = ${t.weekStartPreviousDay})`,
    ),
  ],
);

/**
 * A member of a household: a profile, linked to an account later (ADR-0005 §1, ADR-0007 §1). Only
 * children have a birth date (ADR-0012 §2).
 */
export const members = pgTable(
  'members',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    role: text({ enum: ['head', 'adult', 'child'] }).notNull(),
    birthDate: date(),
    /** For versioned updates (ADR-0019 §5). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    index('members_household').on(t.householdId),
    check('members_name', sql`${t.name} <> ''`),
    check('members_role', sql`${t.role} in ('head', 'adult', 'child')`),
    check('members_birth_date', sql`(${t.role} = 'child') = (${t.birthDate} is not null)`),
  ],
);
