import { expand } from './expand';
import type { Schedule } from './schedule';
import type { Interval } from './since-last-done';

/**
 * How often a task on a calendar schedule occurs in the 12 months from `from`, so seasonal and
 * irregular schedules are weighted by what they really produce (ADR-0004 §7).
 */
export function timesPerYear(schedule: Schedule, from: Temporal.PlainDate) {
  const to = from.add({ years: 1 }).subtract({ days: 1 });
  return expand(schedule, from, to).length;
}

/** How often a "since last done" chore occurs in a year: 365 / N for every N days (ADR-0004 §8). */
export function intervalTimesPerYear(every: Interval) {
  switch (every.unit) {
    case 'days':
      return 365 / every.count;
    case 'weeks':
      return 365 / (7 * every.count);
    case 'months':
      return 12 / every.count;
  }
}
