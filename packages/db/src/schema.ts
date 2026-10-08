import type { HouseholdCalendar, PlanTask, Role, Timing } from '@householdr/domain';
import { sql, type AnyColumn } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './auth-schema';

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

type Weekday = HouseholdCalendar['weekStartDay'];

/** A household and its settings (ADR-0006 §1, ADR-0018 §5). */
export const households = pgTable(
  'households',
  {
    /**
     * A random UUID chosen by the use case that creates the household (CODE-17): row-level security
     * only accepts the new row once the transaction is set to that id.
     */
    id: uuid().primaryKey(),
    name: text().notNull(),
    /** ISO 3166-1 alpha-2, such as `BE`: sets the consent age (ADR-0010 §9). */
    country: text().notNull(),
    /** An offered language, such as `nl`: the culture an invited person starts with (ADR-0016 §2). */
    language: text().notNull(),
    /** An IANA time zone, such as `Europe/Brussels`. */
    timeZone: text().notNull(),
    /** 1 is Monday, 7 is Sunday. */
    weekStartDay: smallint().$type<Weekday>().notNull(),
    /** The latest change of start day: weeks before this date start on `weekStartPreviousDay`. */
    weekStartChangeFrom: date(),
    weekStartPreviousDay: smallint().$type<Weekday>(),
    /** For versioned updates (CODE-14, ADR-0023 §1). */
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
 * A member of a household: a profile, which can be linked to an account later (ADR-0005 §1,
 * ADR-0010 §1, §5). Only children have a birth date (ADR-0012 §2), so the switch to adult at 18
 * clears it (ADR-0010 §7).
 */
export const members = pgTable(
  'members',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    role: text().$type<Role>().notNull(),
    birthDate: date(),
    /**
     * The account the profile is linked to, if any (ADR-0010 §5). Deleting the account keeps the
     * profile, without it (§10).
     */
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    /** For versioned updates (CODE-14, ADR-0023 §1). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    index('members_household').on(t.householdId),
    // One profile per household for an account (ADR-0010 §5).
    uniqueIndex('members_account').on(t.householdId, t.accountId),
    check('members_name', sql`${t.name} <> ''`),
    check('members_role', sql`${t.role} in ('head', 'adult', 'child')`),
    check('members_birth_date', sql`(${t.role} = 'child') = (${t.birthDate} is not null)`),
  ],
);

/**
 * A rule of a schedule as stored: the domain's `Rule`, with its dates as ISO strings (ADR-0004 §2).
 */
export interface StoredRule {
  /** An RFC 5545 `RRULE` without `DTSTART`, such as `FREQ=WEEKLY;INTERVAL=2`. */
  rrule: string;
  /** `YYYY-MM-DD`. */
  start: string;
  /** A yearly range from `MM-DD` to `MM-DD`, both included, which may wrap around new year. */
  season?: { from: string; to: string };
}

// Every rule is an object with an RRULE and a start date, and a season has both its ends.
const wellFormedRules = `$[*] ? (
  @.type() != "object"
  || !exists(@.rrule ? (@.type() == "string" && @ != ""))
  || !exists(@.start ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
  || (exists(@.season) && !(exists(@.season.from ? (@ like_regex "^[0-9]{2}-[0-9]{2}$"))
    && exists(@.season.to ? (@ like_regex "^[0-9]{2}-[0-9]{2}$"))))
)`;

/**
 * What produces the dates of tasks, and can be shared by several (ADR-0004 §1, §2): its rules, each
 * within its season, plus extra dates, minus exception dates. A task on a simple frequency has one
 * of its own, with a single rule (§3).
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    rules: jsonb().$type<StoredRule[]>().notNull(),
    extraDates: date()
      .array()
      .notNull()
      .default(sql`'{}'`),
    exceptionDates: date()
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** For versioned updates (CODE-14, ADR-0019 §5). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    // Tasks refer to a schedule together with their household, so never to another's.
    unique('schedules_household_id').on(t.householdId, t.id),
    check(
      'schedules_rules',
      sql`jsonb_typeof(${t.rules}) = 'array'
        and not jsonb_path_exists(${t.rules}, ${sql.raw(`'${wellFormedRules}'`)})`,
    ),
    // A schedule produces dates: from a rule, or from extra dates only, as an imported calendar
    // would (ADR-0004, Future).
    check('schedules_dates', sql`${t.rules} <> '[]'::jsonb or cardinality(${t.extraDates}) > 0`),
  ],
);

/**
 * A chore of the household (ADR-0001 §1): its name, how long one occurrence takes, the schedule its
 * dates come from, how a date becomes an occurrence window, and what happens to an occurrence that
 * isn't done. Fixed windows, "since last done" intervals, one-off dates, areas, minimum ages and
 * same-person links come with the slices that use them, as columns of their own.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** As typed: household content is never translated (ADR-0016 §6). */
    name: text().notNull(),
    /** Whole minutes for one occurrence, within the domain's `taskDuration` (ADR-0001 §5). */
    duration: integer().notNull(),
    scheduleId: uuid().notNull(),
    /** ADR-0004 §4. */
    timing: text().$type<Exclude<Timing['kind'], 'fixed'>>().notNull(),
    /** ADR-0002 §2. */
    onMiss: text().$type<PlanTask['onMiss']>().notNull(),
    /** For versioned updates (CODE-14, ADR-0019 §5). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    // A schedule of the task's own household, kept while a task uses it.
    foreignKey({
      name: 'tasks_schedule',
      columns: [t.householdId, t.scheduleId],
      foreignColumns: [schedules.householdId, schedules.id],
    }),
    index('tasks_household_schedule').on(t.householdId, t.scheduleId),
    check('tasks_name', sql`${t.name} <> ''`),
    check('tasks_duration', sql`${t.duration} between 1 and 1440`),
    check('tasks_timing', sql`${t.timing} in ('flexible', 'floating')`),
    check('tasks_on_miss', sql`${t.onMiss} in ('roll over', 'lapse')`),
  ],
);
