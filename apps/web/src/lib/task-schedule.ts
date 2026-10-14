import type { TaskSummary } from '@householdr/application';
import {
  weekdays,
  weekdaysOfMonth,
  type AdvancedRule,
  type Weekday,
  type WeekdayOfMonth,
} from '@householdr/domain';

/** A rule of an advanced schedule as page data: its first time as `YYYY-MM-DD` (ADR-0004 §3). */
export type RuleData =
  | { kind: 'weeks'; every: number; days: readonly Weekday[]; start: string }
  | { kind: 'months'; every: number; start: string }
  | {
      kind: 'weekdays-of-month';
      every: number;
      which: readonly WeekdayOfMonth[];
      day: Weekday;
      start: string;
    }
  | { kind: 'year'; start: string };

/** An advanced schedule as page data: its days as `YYYY-MM-DD` (ADR-0004 §3). */
export interface ScheduleData {
  rules: RuleData[];
  extraDates: string[];
  exceptionDates: string[];
}

/** An advanced schedule as page data. */
export const scheduleData = (schedule: NonNullable<TaskSummary['schedule']>): ScheduleData => ({
  rules: schedule.rules.map((rule: AdvancedRule) => ({ ...rule, start: rule.start.toString() })),
  extraDates: schedule.extraDates.map(String),
  exceptionDates: schedule.exceptionDates.map(String),
});

/** The kinds of rule the advanced editor offers, in the order it lists them (ADR-0004 §3). */
export const ruleKinds = ['weeks', 'months', 'weekdays-of-month', 'year'] as const;

/** A rule's fields as its form shows and sends them. */
export interface RuleValues {
  kind: string;
  every: string;
  days: string[];
  which: string[];
  day: string;
  start: string;
}

/** An advanced schedule's fields as its form shows and sends them. */
export interface ScheduleValues {
  rules: RuleValues[];
  extraDates: string[];
  exceptionDates: string[];
}

/** The fields of a new rule: every week, from `start`, on days still to choose. */
export const newRule = (start: string): RuleValues => ({
  kind: 'weeks',
  every: '1',
  days: [],
  which: [],
  day: '1',
  start,
});

/**
 * The schedule fields of a task's form: those of its advanced schedule, or one new rule from
 * `today`, for a task that gets one.
 */
export function scheduleValues(schedule: ScheduleData | undefined, today: string): ScheduleValues {
  if (!schedule) return { rules: [newRule(today)], extraDates: [], exceptionDates: [] };
  return {
    rules: schedule.rules.map((rule) => ({
      ...newRule(rule.start),
      kind: rule.kind,
      every: 'every' in rule ? String(rule.every) : '1',
      ...(rule.kind === 'weeks' && { days: rule.days.map(String) }),
      ...(rule.kind === 'weekdays-of-month' && {
        which: rule.which.map(String),
        day: String(rule.day),
      }),
    })),
    extraDates: [...schedule.extraDates],
    exceptionDates: [...schedule.exceptionDates],
  };
}

/** The texts of a form's field that are sent more than once, such as checked boxes. */
const texts = (form: FormData, field: string) =>
  form.getAll(field).filter((value): value is string => typeof value === 'string');

/** The text of a form's field, or nothing. */
const text = (form: FormData, field: string) => texts(form, field)[0] ?? '';

/** A rule's field name in the form: `rule-0-kind` for the kind of the first. */
export const ruleField = (index: number, field: keyof RuleValues) =>
  `rule-${String(index)}-${field}`;

/** The schedule fields a task's form sent, its rules in order, as long as they come. */
export function sentSchedule(form: FormData): ScheduleValues {
  const rules: RuleValues[] = [];
  for (let i = 0; form.has(ruleField(i, 'kind')); i++) {
    rules.push({
      kind: text(form, ruleField(i, 'kind')),
      every: text(form, ruleField(i, 'every')),
      days: texts(form, ruleField(i, 'days')),
      which: texts(form, ruleField(i, 'which')),
      day: text(form, ruleField(i, 'day')),
      start: text(form, ruleField(i, 'start')),
    });
  }
  return {
    rules,
    extraDates: texts(form, 'extraDates'),
    exceptionDates: texts(form, 'exceptionDates'),
  };
}

/**
 * The schedule as the use cases take it: each rule with the fields of its kind, as a form without
 * scripts sends them all, and the dates that were filled in (ADR-0004 §3).
 */
function scheduleInput(values: ScheduleValues) {
  const numbers = (list: string[]) => list.map(Number);
  return {
    rules: values.rules.map(({ kind, every, days, which, day, start }) => {
      if (kind === 'weeks') return { kind, every: Number(every), days: numbers(days), start };
      if (kind === 'months') return { kind, every: Number(every), start };
      if (kind === 'weekdays-of-month') {
        return { kind, every: Number(every), which: numbers(which), day: Number(day), start };
      }
      return { kind, start };
    }),
    extraDates: values.extraDates.filter(Boolean),
    exceptionDates: values.exceptionDates.filter(Boolean),
  };
}

/**
 * The schedule fields as the use cases take them, for a task on an advanced schedule; for any
 * other, none of them, as a form without scripts sends them with any choice.
 */
export function scheduleFields(values: ScheduleValues & { frequency: string }) {
  if (values.frequency === 'advanced') return scheduleInput(values);
  return { rules: undefined, extraDates: undefined, exceptionDates: undefined };
}

/** A change to the rows of the schedule's form, which its buttons send instead of saving. */
const change = /^(add|remove)-(rule|extra|exception)(?:-(\d+))?$/;

/**
 * The schedule fields after the change a button of its form asked for, adding a rule, whose first
 * time the form fills in with today, or a date to fill in, or removing one; or undefined if it
 * asked for none. The page shows the form again with them, with or without scripts (CODE-10).
 */
export function changedSchedule(values: ScheduleValues, asked: string): ScheduleValues | undefined {
  const [, action, row, at] = change.exec(asked) ?? [];
  if (!action || !row) return undefined;
  const index = Number(at);
  const without = <T>(list: T[]) => list.filter((_, i) => i !== index);
  if (row === 'rule') {
    const rules = action === 'add' ? [...values.rules, newRule('')] : without(values.rules);
    return { ...values, rules };
  }
  const field = row === 'extra' ? 'extraDates' : 'exceptionDates';
  return { ...values, [field]: action === 'add' ? [...values[field], ''] : without(values[field]) };
}

/** A whole number of weeks or months, as typed. */
const wholeNumber = /^[1-9]\d*$/;

/**
 * The schedule its form's fields give so far, to say in words while it is built: the rules
 * that are complete and the dates that are filled in; anything else waits.
 */
export function scheduleSoFar(values: ScheduleValues): ScheduleData {
  const days = (list: string[]) => weekdays.filter((day) => list.includes(String(day)));
  const rules = values.rules.flatMap((sent): RuleData[] => {
    const { kind, start } = sent;
    if (!start || !wholeNumber.test(sent.every || '1')) return [];
    const every = Number(sent.every || '1');
    if (kind === 'weeks') {
      const on = days(sent.days);
      return on.length > 0 ? [{ kind, every, days: on, start }] : [];
    }
    if (kind === 'weekdays-of-month') {
      const which = weekdaysOfMonth.filter((nth) => sent.which.includes(String(nth)));
      const [day] = days([sent.day]);
      return which.length > 0 && day ? [{ kind, every, which, day, start }] : [];
    }
    if (kind === 'months') return [{ kind, every, start }];
    return kind === 'year' ? [{ kind, start }] : [];
  });
  const { extraDates, exceptionDates } = scheduleInput(values);
  return { rules, extraDates, exceptionDates };
}
