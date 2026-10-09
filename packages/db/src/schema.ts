import {
  defaultPlanTimings,
  defaultRebalance,
  type HouseholdCalendar,
  type PlanStatus,
  type PlanTask,
  type Reason,
  type RebalancePreset,
  type Role,
  type Timing,
  type UnassignedCause,
} from '@householdr/domain';
import { sql, type AnyColumn } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
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
    /**
     * The first day of its first plan week, which Start records; none while it is in setup, when no
     * plan is drafted or published for it (ADR-0007 §2).
     */
    firstPlanWeek: date(),
    /** When plans are drafted and published: hours before the week starts (ADR-0006 §2). */
    draftHours: smallint().notNull().default(defaultPlanTimings.draft),
    publishHours: smallint().notNull().default(defaultPlanTimings.publish),
    /** How fast balances are caught up on (ADR-0002 §3). */
    rebalance: text().$type<RebalancePreset>().notNull().default(defaultRebalance),
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
    // A draft comes before publishing, which comes at the latest when the week starts.
    check(
      'households_plan_timings',
      sql`${t.publishHours} >= 0 and ${t.draftHours} > ${t.publishHours}`,
    ),
    check('households_rebalance', sql`${t.rebalance} in ('fast', 'normal', 'slow')`),
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
    /**
     * The share a head set instead of the default by role and age, in whole percent of a full
     * share; none for the default (ADR-0001 §4). Never a reason for it (ADR-0012 §2).
     */
    sharePercent: smallint(),
    /** For versioned updates (CODE-14, ADR-0023 §1). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    // Assignments refer to a member together with their household, so never to another's.
    unique('members_household_id').on(t.householdId, t.id),
    index('members_household').on(t.householdId),
    // One profile per household for an account (ADR-0010 §5).
    uniqueIndex('members_account').on(t.householdId, t.accountId),
    check('members_name', sql`${t.name} <> ''`),
    check('members_role', sql`${t.role} in ('head', 'adult', 'child')`),
    check('members_birth_date', sql`(${t.role} = 'child') = (${t.birthDate} is not null)`),
    check('members_share_percent', sql`${t.sharePercent} between 0 and 100`),
  ],
);

/**
 * A share for a period, both days included, which replaces a member's share on the days it covers
 * (ADR-0001 §4, clarifications). A member's never overlap, which adding one checks with the member
 * locked. Never a reason for it (ADR-0012 §2).
 */
export const temporaryShares = pgTable(
  'temporary_shares',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    firstDay: date().notNull(),
    lastDay: date().notNull(),
    /** In whole percent of a full share, as `members.share_percent`. */
    percent: smallint().notNull(),
  },
  (t) => [
    householdOnly(t.householdId),
    index('temporary_shares_member').on(t.householdId, t.memberId, t.firstDay),
    check('temporary_shares_days', sql`${t.firstDay} <= ${t.lastDay}`),
    check('temporary_shares_percent', sql`${t.percent} between 0 and 100`),
  ],
);

/** What an entry of the activity log says was done (ADR-0018 §5). */
export type ActivityAction =
  /** A head changed the household's name, time zone, language or country (ADR-0007 §2). */
  | 'household.name'
  | 'household.timeZone'
  | 'household.language'
  | 'household.country'
  /** A head started the household, which ends setting it up (ADR-0007 §2 step 7, §3). */
  | 'household.started';

/**
 * What was set for other members before the household started, which its start entry lists
 * (ADR-0007 §2, ADR-0018 §5, clarifications): whose share a head set, as a share of their own or a
 * temporary one, and for which profiles without an account days away were planned, by a head
 * acting for them. Member ids only, never a value: no share, no day.
 */
export interface SetBeforeStart {
  shares: string[];
  daysAway: string[];
}

// An entry of the start entry's object that isn't one of its two lists of member ids (UUIDs).
const notMemberIds = `$.keyvalue() ? ((@.key != "shares" && @.key != "daysAway")
  || @.value.type() != "array"
  || exists(@.value[*] ? (@.type() != "string"
    || !(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))))`;

/**
 * The household's activity log (ADR-0018 §5): who did what to whom, for every member to see. An
 * entry never changes and is never deleted while the household exists: the app's role may only add
 * and read them (`migrate.ts`).
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    at: timestamp({ withTimezone: true }).notNull(),
    /** Who did it; none once their profile is deleted, when they show as a former member. */
    actorId: uuid().references(() => members.id, { onDelete: 'set null' }),
    action: text().$type<ActivityAction>().notNull(),
    /**
     * For `household.started`, and only for it: what was set for others before the start. A member
     * whose profile goes stays in it by id, which then names nobody (ADR-0012 §6).
     */
    setBeforeStart: jsonb().$type<SetBeforeStart>(),
  },
  (t) => [
    householdOnly(t.householdId),
    index('activity_log_household_at').on(t.householdId, t.at),
    check(
      'activity_log_action',
      sql`${t.action} in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started')`,
    ),
    // The start entry, and only it, lists what was set before the start: two lists of member ids,
    // and nothing else, so never a value (ADR-0018 §5).
    check(
      'activity_log_set_before_start',
      sql`(${t.action} = 'household.started') = (${t.setBeforeStart} is not null)
        and case
          when ${t.setBeforeStart} is null then true
          when jsonb_typeof(${t.setBeforeStart}) <> 'object' then false
          else ${t.setBeforeStart} ?& array['shares', 'daysAway']
            and not jsonb_path_exists(${t.setBeforeStart}, ${sql.raw(`'${notMemberIds}'`)})
        end`,
    ),
  ],
);

/**
 * A member's planned absence (ADR-0005 §2): the domain's `Absence`, from `firstDay` to `lastDay`,
 * whole days in the household's time zone, both included. No reason, place or detail is asked or
 * stored (ADR-0012 §2, ADR-0018 §3). It goes with the member's profile.
 */
export const absences = pgTable(
  'absences',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    firstDay: date().notNull(),
    lastDay: date().notNull(),
  },
  (t) => [
    householdOnly(t.householdId),
    // Who is away in a range of days: those whose last day is in or after it (ADR-0001 §6).
    index('absences_household_days').on(t.householdId, t.lastDay, t.firstDay),
    // For a member's absences to go with their profile without reading the whole table.
    index('absences_member').on(t.memberId),
    check('absences_days', sql`${t.lastDay} >= ${t.firstDay}`),
  ],
);

/**
 * A period when the whole household is away together, such as a family holiday (ADR-0005 §5): whole
 * days in the household's time zone, both included. Weeks entirely inside it get no plan, and
 * occurrences whose whole window falls inside it are skipped.
 */
export const awayPeriods = pgTable(
  'away_periods',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    firstDay: date().notNull(),
    lastDay: date().notNull(),
  },
  (t) => [
    householdOnly(t.householdId),
    // The periods that touch a range of days: those whose last day is in or after it.
    index('away_periods_household_days').on(t.householdId, t.lastDay, t.firstDay),
    check('away_periods_days', sql`${t.lastDay} >= ${t.firstDay}`),
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
    // Occurrences refer to a task together with its household, so never to another's.
    unique('tasks_household_id').on(t.householdId, t.id),
    index('tasks_household_schedule').on(t.householdId, t.scheduleId),
    check('tasks_name', sql`${t.name} <> ''`),
    check('tasks_duration', sql`${t.duration} between 1 and 1440`),
    check('tasks_timing', sql`${t.timing} in ('flexible', 'floating')`),
    check('tasks_on_miss', sql`${t.onMiss} in ('roll over', 'lapse')`),
  ],
);

/**
 * A household's plan for one plan week (ADR-0001 §1, ADR-0006 §1–§2): from 00:00 on `weekStart` up
 * to 00:00 on `weekEnd` in the household's time zone, seven days, or 4 to 10 for the transition week
 * after a change of start day. A draft only heads see, then published and frozen (ADR-0006 §3).
 * A week the household is away for entirely has none (ADR-0005 §5).
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    weekStart: date().notNull(),
    weekEnd: date().notNull(),
    status: text().$type<PlanStatus>().notNull(),
    /** When the allocator last drafted it. */
    draftedAt: timestamp({ withTimezone: true }).notNull(),
    /** When it was published: by the scheduler at its time, or earlier by a head. */
    publishedAt: timestamp({ withTimezone: true }),
    /** A head publishes the draft they saw (ADR-0019 §5); drafting it again moves it on. */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    unique('plans_household_id').on(t.householdId, t.id),
    // One plan a week, found by its first day.
    unique('plans_week').on(t.householdId, t.weekStart),
    check('plans_week_length', sql`${t.weekEnd} - ${t.weekStart} between 4 and 10`),
    check('plans_status', sql`${t.status} in ('draft', 'published')`),
    check('plans_published', sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`),
  ],
);

/** Where an occurrence is: still to do, done, closed as missed, or skipped as away. */
export type OccurrenceStatus = 'open' | 'done' | 'missed' | 'away';

/**
 * One concrete instance of a task, with its own window (ADR-0001 §1, ADR-0004 §4), as `occurrences`
 * gives it: for a floating one, the weeks it may float over, not the week it was planned in. Its
 * task and schedule date are who it is, across drafts and weeks: the domain names it
 * `task@date`. It outlives the plans it is in: an open one goes back into the next week's pool, and
 * closes as missed by its task's on-miss policy (ADR-0002 §2), or as away when its whole window
 * falls while the household is away (ADR-0005 §5). Done waits for completions (ADR-0006 §4).
 */
export const occurrences = pgTable(
  'occurrences',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    taskId: uuid().notNull(),
    /** Its schedule date, in the household's time zone. */
    date: date().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    windowEnd: timestamp({ withTimezone: true }).notNull(),
    status: text().$type<OccurrenceStatus>().notNull().default('open'),
    /**
     * The plan whose drafting closed it as missed or away; drafting that plan again, while it is a
     * draft, opens it again first.
     */
    closedByPlan: uuid(),
  },
  (t) => [
    householdOnly(t.householdId),
    unique('occurrences_household_id').on(t.householdId, t.id),
    unique('occurrences_task_date').on(t.householdId, t.taskId, t.date),
    // A task of the occurrence's own household, kept while it has occurrences.
    foreignKey({
      name: 'occurrences_task',
      columns: [t.householdId, t.taskId],
      foreignColumns: [tasks.householdId, tasks.id],
    }),
    foreignKey({
      name: 'occurrences_closed_by_plan',
      columns: [t.householdId, t.closedByPlan],
      foreignColumns: [plans.householdId, plans.id],
    }),
    // The open ones, which every draft reads as the pool from earlier weeks.
    index('occurrences_household_status').on(t.householdId, t.status),
    check('occurrences_window', sql`${t.windowStart} < ${t.windowEnd}`),
    check('occurrences_status', sql`${t.status} in ('open', 'done', 'missed', 'away')`),
    check(
      'occurrences_closed',
      sql`(${t.status} in ('missed', 'away')) = (${t.closedByPlan} is not null)`,
    ),
  ],
);

/**
 * An occurrence in a plan (ADR-0001 §1, §7): given to a member, with the points it costs them and
 * the reason it went to them, or left unassigned with the cause, which heads see (ADR-0001 §7,
 * clarification). Its window is the one in this plan, which for an occurrence from an earlier week
 * or a floating one is part of its own. Heads' changes to a draft go by its version (ADR-0019 §5).
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    planId: uuid().notNull(),
    occurrenceId: uuid().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    windowEnd: timestamp({ withTimezone: true }).notNull(),
    memberId: uuid(),
    /** Points: the task's minutes times the member's burden (ADR-0001 §5). */
    cost: doublePrecision(),
    reason: text().$type<Reason>(),
    unassignedCause: text().$type<UnassignedCause>(),
    /** For versioned updates (CODE-14, ADR-0019 §5). */
    version: integer().notNull().default(1),
  },
  (t) => [
    householdOnly(t.householdId),
    // An occurrence is in a plan once.
    unique('assignments_plan_occurrence').on(t.planId, t.occurrenceId),
    // The plans an occurrence is in, which tell whether it was planned before.
    index('assignments_occurrence_plans').on(t.occurrenceId),
    // A plan of the household's own, whose assignments go with it.
    foreignKey({
      name: 'assignments_plan',
      columns: [t.householdId, t.planId],
      foreignColumns: [plans.householdId, plans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assignments_occurrence',
      columns: [t.householdId, t.occurrenceId],
      foreignColumns: [occurrences.householdId, occurrences.id],
    }),
    foreignKey({
      name: 'assignments_member',
      columns: [t.householdId, t.memberId],
      foreignColumns: [members.householdId, members.id],
    }),
    check('assignments_window', sql`${t.windowStart} < ${t.windowEnd}`),
    // Given to a member with its cost and reason, or unassigned with its cause.
    check(
      'assignments_assigned',
      sql`(${t.memberId} is not null and ${t.cost} is not null and ${t.reason} is not null
          and ${t.unassignedCause} is null)
        or (${t.memberId} is null and ${t.cost} is null and ${t.reason} is null
          and ${t.unassignedCause} is not null)`,
    ),
    check('assignments_cost', sql`${t.cost} >= 0`),
    check(
      'assignments_reason',
      sql`${t.reason} in ('bound', 'assigned by head', 'linked', 'only eligible member',
        'lowest relative load', 'catching up')`,
    ),
    check(
      'assignments_unassigned_cause',
      sql`${t.unassignedCause} in ('nobody eligible', 'bound member not eligible',
        'linked member not eligible')`,
    ),
  ],
);
