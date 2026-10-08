import type { Schedule } from '@householdr/domain';
import { describe, expect, it } from 'vitest';
import { scheduleOf, storedRules } from './stored-schedule';

// A schedule's row keeps the domain's schedule, dates as ISO strings (ADR-0004 §2).

describe('stored schedules (ADR-0004 §2)', () => {
  it('keep rules, seasons and dates as they were', () => {
    const schedule: Schedule = {
      rules: [
        {
          rrule: 'FREQ=MONTHLY;BYDAY=2TU,4TU',
          start: Temporal.PlainDate.from('2026-01-01'),
          season: {
            from: Temporal.PlainMonthDay.from('09-01'),
            to: Temporal.PlainMonthDay.from('06-30'),
          },
        },
        { rrule: 'FREQ=WEEKLY;BYDAY=TU', start: Temporal.PlainDate.from('2026-01-01') },
      ],
      extraDates: [Temporal.PlainDate.from('2026-12-24')],
      exceptionDates: [Temporal.PlainDate.from('2026-12-22')],
    };
    const rules = storedRules(schedule.rules);
    expect(rules).toEqual([
      {
        rrule: 'FREQ=MONTHLY;BYDAY=2TU,4TU',
        start: '2026-01-01',
        season: { from: '09-01', to: '06-30' },
      },
      { rrule: 'FREQ=WEEKLY;BYDAY=TU', start: '2026-01-01' },
    ]);
    const read = scheduleOf({ rules, extraDates: ['2026-12-24'], exceptionDates: ['2026-12-22'] });
    // Temporal values compare by their text.
    expect(JSON.parse(JSON.stringify(read))).toEqual(JSON.parse(JSON.stringify(schedule)));
  });
});
