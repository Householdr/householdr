import { describe, expect, it } from 'vitest';
import { scheduleWords } from './schedule-words';
import type { ScheduleData } from './task-schedule';

// An advanced schedule read back in plain words, never as its rules (ADR-0004 §3, clarification).

const start = '2026-10-15';
const words = (schedule: Partial<ScheduleData>) =>
  scheduleWords({ rules: [], extraDates: [], exceptionDates: [], ...schedule }, 'en-GB');

describe('scheduleWords (ADR-0004 §3)', () => {
  it('says the waste calendar the ADR tests itself with', () => {
    expect(
      words({
        rules: [
          { kind: 'weekdays-of-month', every: 1, which: [4, 2], day: 2, start },
          { kind: 'weeks', every: 1, days: [3], start },
        ],
        exceptionDates: ['2026-11-11'],
      }),
    ).toBe('Every 2nd and 4th Tuesday of the month and every Wednesday; not on 11 November 2026');
  });

  it('says each kind of rule with its spacing', () => {
    expect(words({ rules: [{ kind: 'weeks', every: 2, days: [4, 1], start }] })).toBe(
      'Every 2 weeks on Monday and Thursday',
    );
    expect(words({ rules: [{ kind: 'months', every: 1, start: '2026-10-31' }] })).toBe(
      'Every month on day 31',
    );
    expect(words({ rules: [{ kind: 'months', every: 3, start }] })).toBe(
      'Every 3 months on day 15',
    );
    expect(
      words({ rules: [{ kind: 'weekdays-of-month', every: 2, which: [-1], day: 5, start }] }),
    ).toBe('Every 2 months on the last Friday');
    expect(words({ rules: [{ kind: 'year', start: '2027-03-03' }] })).toBe('Every year on 3 March');
  });

  it('adds extra dates in order, or gives them alone', () => {
    const rule = { kind: 'weeks', every: 1, days: [3], start } as const;
    expect(words({ rules: [rule], extraDates: ['2026-12-24', '2026-11-12'] })).toBe(
      'Every Wednesday; also on 12 November 2026 and 24 December 2026',
    );
    expect(words({ extraDates: ['2026-10-17'] })).toBe('On 17 October 2026');
  });
});
