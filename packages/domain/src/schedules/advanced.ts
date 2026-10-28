import type { Rule, Schedule } from './schedule';

/** A day of the week, from Monday (1) to Sunday (7), as Temporal numbers them. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Which of a weekday in its month: the 1st to the 4th, or the last (-1). */
export type WeekdayOfMonth = 1 | 2 | 3 | 4 | -1;

/**
 * A rule as the advanced editor builds it (ADR-0004 §3, clarifications): every N weeks on one or
 * more weekdays; every N months, or every year, on the day of its first time; or every N months on
 * the 1st to the 4th or last of a weekday. Each starts on its first time.
 */
export type AdvancedRule =
  | { kind: 'weeks'; every: number; days: readonly Weekday[]; start: Temporal.PlainDate }
  | { kind: 'months'; every: number; start: Temporal.PlainDate }
  | {
      kind: 'weekdays-of-month';
      every: number;
      which: readonly WeekdayOfMonth[];
      day: Weekday;
      start: Temporal.PlainDate;
    }
  | { kind: 'year'; start: Temporal.PlainDate };

/** The limits of the advanced editor (ADR-0004 §3, clarifications). */
export const advancedSchedule = {
  rules: 5,
  /** Of extra dates, and of exception dates. */
  dates: 50,
  weeks: 52,
  months: 12,
} as const;

export const weekdays: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const weekdaysOfMonth: readonly WeekdayOfMonth[] = [1, 2, 3, 4, -1];

const byDay = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const positive = /^[1-9]\d*$/;
const weekdayOfMonth = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/;

/** The `BYDAY` code of a weekday. */
const code = (day: Weekday): string => byDay[day - 1] ?? '';

/** The weekday of a `BYDAY` code, or undefined. */
const weekdayOf = (text: string) => weekdays.find((day) => code(day) === text);

/** The 1st to the 4th first, and the last after them. */
const inMonthOrder = (a: WeekdayOfMonth, b: WeekdayOfMonth) => (a < 0 ? 5 : a) - (b < 0 ? 5 : b);

/** The rule an advanced one compiles to, with its days in order; never shown to anyone. */
export function advancedRule(rule: AdvancedRule): Rule {
  const interval = (every: number) => (every > 1 ? `;INTERVAL=${String(every)}` : '');
  const { start } = rule;
  switch (rule.kind) {
    case 'weeks': {
      const on = rule.days.toSorted((a, b) => a - b).map(code);
      return { rrule: `FREQ=WEEKLY${interval(rule.every)};BYDAY=${on.join(',')}`, start };
    }
    case 'months':
      return { rrule: `FREQ=MONTHLY${interval(rule.every)}`, start };
    case 'weekdays-of-month': {
      const on = rule.which.toSorted(inMonthOrder).map((nth) => String(nth) + code(rule.day));
      return { rrule: `FREQ=MONTHLY${interval(rule.every)};BYDAY=${on.join(',')}`, start };
    }
    case 'year':
      return { rrule: 'FREQ=YEARLY', start };
  }
}

/**
 * A rule read back as the advanced editor built it, so nobody sees `RRULE` syntax (ADR-0004 §3).
 * Undefined for any other rule, such as a daily one or one with a season.
 */
export function advancedRuleOf(rule: Rule): AdvancedRule | undefined {
  if (rule.season) return undefined;
  const parts = new Map(rule.rrule.split(';').map((part) => part.split('=') as [string, string]));
  if ([...parts.keys()].some((key) => !['FREQ', 'INTERVAL', 'BYDAY'].includes(key))) {
    return undefined;
  }
  const interval = parts.get('INTERVAL');
  if (interval !== undefined && !positive.test(interval)) return undefined;
  const every = Number(interval ?? 1);
  const days = parts.get('BYDAY')?.split(',');
  const { start } = rule;
  switch (parts.get('FREQ')) {
    case 'WEEKLY': {
      const on = days?.map(weekdayOf);
      if (!on || on.some((day) => day === undefined)) return undefined;
      return { kind: 'weeks', every, days: on as Weekday[], start };
    }
    case 'MONTHLY': {
      if (!days) return { kind: 'months', every, start };
      const parsed = days.map((day) => weekdayOfMonth.exec(day));
      const day = weekdayOf(parsed[0]?.[2] ?? '');
      if (!day || parsed.some((match) => match?.[2] !== code(day))) return undefined;
      const which = parsed.map((match) => Number(match?.[1]) as WeekdayOfMonth);
      return { kind: 'weekdays-of-month', every, which, day, start };
    }
    case 'YEARLY':
      return interval === undefined && !days ? { kind: 'year', start } : undefined;
    default:
      return undefined;
  }
}

/** Whether an advanced rule keeps to the editor's limits: N within them, and its days each once. */
export function isAdvancedRule(rule: AdvancedRule): boolean {
  const every = (max: number) =>
    'every' in rule && Number.isInteger(rule.every) && rule.every >= 1 && rule.every <= max;
  const distinct = (list: readonly unknown[]) =>
    list.length > 0 && new Set(list).size === list.length;
  switch (rule.kind) {
    case 'weeks':
      return every(advancedSchedule.weeks) && distinct(rule.days);
    case 'months':
      return every(advancedSchedule.months);
    case 'weekdays-of-month':
      return every(advancedSchedule.months) && distinct(rule.which);
    case 'year':
      return true;
  }
}

/** A schedule as the advanced editor builds it: its rules, extra dates and exception dates. */
export interface AdvancedSchedule {
  rules: readonly AdvancedRule[];
  extraDates: readonly Temporal.PlainDate[];
  exceptionDates: readonly Temporal.PlainDate[];
}

/** The schedule an advanced one compiles to. */
export function scheduleOfAdvanced(advanced: AdvancedSchedule): Schedule {
  return { ...advanced, rules: advanced.rules.map(advancedRule) };
}

/** A schedule read back as the advanced editor built it, or undefined if it can't be. */
export function advancedScheduleOf(schedule: Schedule): AdvancedSchedule | undefined {
  const rules = schedule.rules.map(advancedRuleOf);
  if (rules.some((rule) => rule === undefined)) return undefined;
  return { ...schedule, rules: rules as AdvancedRule[] };
}

/**
 * Whether a schedule of the advanced editor can be saved (ADR-0004 §3, clarifications): up to five
 * rules, each within the limits; up to 50 extra and 50 exception dates, each once; and at least one
 * rule or extra date. Its first times and dates are checked on their own (`isStartDay`,
 * `isScheduleDate`).
 */
export function isAdvancedSchedule(advanced: AdvancedSchedule): boolean {
  const { rules, extraDates, exceptionDates } = advanced;
  const once = (dates: readonly Temporal.PlainDate[]) =>
    dates.length <= advancedSchedule.dates &&
    new Set(dates.map((date) => date.toString())).size === dates.length;
  return (
    rules.length <= advancedSchedule.rules &&
    rules.every(isAdvancedRule) &&
    once(extraDates) &&
    once(exceptionDates) &&
    (rules.length > 0 || extraDates.length > 0)
  );
}

/**
 * The days a new extra or exception date can be on, given `today` in the household's time zone:
 * from today up to two years on (ADR-0004 §3, clarification).
 */
export function scheduleDateRange(today: Temporal.PlainDate) {
  return { earliest: today, latest: today.add({ years: 2 }) };
}

/**
 * Whether `date` can be an extra or exception date, given `today`: a day within
 * `scheduleDateRange(today)`, or, when a schedule changes, one of the dates it has already
 * (`kept`), which may have passed (ADR-0004 §3, clarification).
 */
export function isScheduleDate(
  date: Temporal.PlainDate,
  today: Temporal.PlainDate,
  kept: readonly Temporal.PlainDate[] = [],
): boolean {
  if (kept.some((day) => day.equals(date))) return true;
  const { earliest, latest } = scheduleDateRange(today);
  return (
    Temporal.PlainDate.compare(date, earliest) >= 0 && Temporal.PlainDate.compare(date, latest) <= 0
  );
}
