import { dayText, fullDay } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { PastDay } from '@householdr/application';

/** A past day as `PastDay` shows it: vaguely, and exactly, in `locale` (ADR-0008 §6). */
export interface PastDayWords {
  said: string;
  exact: string;
  datetime: string;
}

const vaguely: Record<Exclude<PastDay, 'older'>, () => string> = {
  today: m['past.today'],
  yesterday: m['past.yesterday'],
  'some-days-ago': m['past.some-days-ago'],
  'last-week': m['past.last-week'],
  'some-weeks-ago': m['past.some-weeks-ago'],
};

/**
 * The day `day` (`YYYY-MM-DD`), `when` long ago, in words: as vague as the scale says, never finer
 * than the day (ADR-0018 §3), and longer ago as the day itself (ADR-0008 §6, clarification).
 */
export function pastDayWords(when: PastDay, day: string, locale: string): PastDayWords {
  const exact = fullDay(day, locale);
  return {
    said: when === 'older' ? dayText(day, locale) : vaguely[when](),
    exact,
    datetime: day,
  };
}
