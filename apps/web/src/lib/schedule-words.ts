import type { WeekdayOfMonth } from '@householdr/domain';
import { dayText, listOf, weekdayName } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { RuleData, ScheduleData } from '#lib/task-schedule.js';

/** Which of a weekday in its month, in words, such as “2nd” or “last”. */
export const whichWords: Record<WeekdayOfMonth, () => string> = {
  1: m['schedule.first'],
  2: m['schedule.second'],
  3: m['schedule.third'],
  4: m['schedule.fourth'],
  [-1]: m['schedule.last'],
};

/** The day of the month and the month of `date` (`YYYY-MM-DD`) in `locale`, such as “3 March”. */
function dayOfYear(date: string, locale: string) {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  const format = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return format.format(Date.UTC(year, month - 1, day));
}

/** A rule of the advanced editor in words, such as “every 2nd and 4th Tuesday of the month”. */
function ruleWords(rule: RuleData, locale: string) {
  switch (rule.kind) {
    case 'weeks': {
      const days = listOf(
        rule.days.toSorted((a, b) => a - b).map((day) => weekdayName(day, locale)),
        locale,
      );
      return m['schedule.weeks']({ count: rule.every, days });
    }
    case 'months':
      return m['schedule.months']({ count: rule.every, day: Number(rule.start.slice(8)) });
    case 'weekdays-of-month': {
      const order = (n: WeekdayOfMonth) => (n < 0 ? 5 : n);
      const which = rule.which.toSorted((a, b) => order(a) - order(b)).map((n) => whichWords[n]());
      const day = weekdayName(rule.day, locale);
      return m['schedule.weekdays-of-month']({
        count: rule.every,
        which: listOf(which, locale),
        day,
      });
    }
    case 'year':
      return m['schedule.year']({ date: dayOfYear(rule.start, locale) });
  }
}

/**
 * An advanced schedule in words, never as its rules (ADR-0004 §3, clarification): “Every 2nd and
 * 4th Tuesday of the month and every Wednesday; also on 24 December 2026; not on 11 November
 * 2026”.
 */
export function scheduleWords(schedule: ScheduleData, locale: string) {
  const days = (dates: readonly string[]) =>
    listOf(
      dates.toSorted().map((date) => dayText(date, locale)),
      locale,
    );
  const parts = [];
  if (schedule.rules.length > 0) {
    parts.push(
      listOf(
        schedule.rules.map((rule) => ruleWords(rule, locale)),
        locale,
      ),
    );
  }
  if (schedule.extraDates.length > 0) {
    const dates = days(schedule.extraDates);
    parts.push(parts.length > 0 ? m['schedule.also-on']({ dates }) : m['schedule.on']({ dates }));
  }
  if (schedule.exceptionDates.length > 0) {
    parts.push(m['schedule.not-on']({ dates: days(schedule.exceptionDates) }));
  }
  const words = parts.join('; ');
  return words.charAt(0).toLocaleUpperCase(locale) + words.slice(1);
}
