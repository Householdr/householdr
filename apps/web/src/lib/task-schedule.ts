import type { TaskSummary } from '@householdr/application';
import type { AdvancedRule, Weekday, WeekdayOfMonth } from '@householdr/domain';

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
