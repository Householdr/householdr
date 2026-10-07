import { describe, expect, it } from 'vitest';
import { frequencyRule } from './frequency';
import type { Schedule } from './schedule';
import { intervalTimesPerYear, timesPerYear } from './yearly';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const monthDay = (iso: string) => Temporal.PlainMonthDay.from(iso);
const schedule = (parts: Partial<Schedule>): Schedule => ({
  rules: [],
  extraDates: [],
  exceptionDates: [],
  ...parts,
});
const simple = (frequency: Parameters<typeof frequencyRule>[0]) =>
  schedule({ rules: [frequencyRule(frequency, date('2026-10-07'))] });

describe('timesPerYear (ADR-0004 §7)', () => {
  it('counts what the simple frequencies produce in the next 12 months', () => {
    const from = date('2026-10-07');
    expect(timesPerYear(simple('daily'), from)).toBe(365);
    expect(timesPerYear(simple('weekly'), from)).toBe(53);
    expect(timesPerYear(simple('biweekly'), from)).toBe(27);
    expect(timesPerYear(simple('monthly'), from)).toBe(12);
    expect(timesPerYear(simple('tri-monthly'), from)).toBe(4);
    expect(timesPerYear(simple('yearly'), from)).toBe(1);
  });

  it('weights a seasonal schedule by what it really produces', () => {
    const pmd = schedule({
      rules: [
        {
          rrule: 'FREQ=MONTHLY;BYDAY=2TU,4TU',
          start: date('2026-01-01'),
          season: { from: monthDay('09-01'), to: monthDay('06-30') },
        },
        {
          rrule: 'FREQ=WEEKLY;BYDAY=TU',
          start: date('2026-01-01'),
          season: { from: monthDay('07-01'), to: monthDay('08-31') },
        },
      ],
    });
    // Ten months of the 2nd and 4th Tuesday, and every Tuesday of July and August 2027.
    expect(timesPerYear(pmd, date('2026-09-01'))).toBe(20 + 9);
  });

  it('counts extra dates and leaves out exception dates', () => {
    const shifted = schedule({
      ...simple('monthly'),
      extraDates: [date('2026-12-24')],
      exceptionDates: [date('2026-12-07')],
    });
    expect(timesPerYear(shifted, date('2026-10-07'))).toBe(12);
  });
});

describe('intervalTimesPerYear (ADR-0004 §8)', () => {
  it('counts 365 / N for every N days, and the same rate in weeks and months', () => {
    expect(intervalTimesPerYear({ count: 42, unit: 'days' })).toBeCloseTo(8.69, 2);
    expect(intervalTimesPerYear({ count: 6, unit: 'weeks' })).toBeCloseTo(8.69, 2);
    expect(intervalTimesPerYear({ count: 2, unit: 'months' })).toBe(6);
  });
});
