import { describe, expect, it } from 'vitest';
import { expand } from './expand';
import { frequencyRule } from './frequency';
import type { Schedule } from './schedule';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const monthDay = (iso: string) => Temporal.PlainMonthDay.from(iso);
const dates = (schedule: Schedule, from: string, to: string) =>
  expand(schedule, date(from), date(to)).map((d) => d.toString());
const schedule = (parts: Partial<Schedule>): Schedule => ({
  rules: [],
  extraDates: [],
  exceptionDates: [],
  ...parts,
});

// The waste-collection calendar ADR-0004 uses to test expressiveness.
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

describe('expand (ADR-0004 §2)', () => {
  it('follows a seasonal schedule into summer and back', () => {
    expect(dates(pmd, '2026-06-01', '2026-09-30')).toEqual([
      '2026-06-09',
      '2026-06-23',
      '2026-07-07',
      '2026-07-14',
      '2026-07-21',
      '2026-07-28',
      '2026-08-04',
      '2026-08-11',
      '2026-08-18',
      '2026-08-25',
      '2026-09-08',
      '2026-09-22',
    ]);
  });

  it('keeps a season that wraps around new year', () => {
    expect(dates(pmd, '2026-12-01', '2027-01-31')).toEqual([
      '2026-12-08',
      '2026-12-22',
      '2027-01-12',
      '2027-01-26',
    ]);
  });

  it('expresses the other collections with one rule each', () => {
    const residual = schedule({
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=WE', start: date('2026-01-01') }],
    });
    const paper = schedule({
      rules: [{ rrule: 'FREQ=MONTHLY;BYDAY=1TU', start: date('2026-01-01') }],
    });
    const garden = schedule({
      rules: [{ rrule: 'FREQ=MONTHLY;BYDAY=3WE', start: date('2026-01-01') }],
    });
    expect(dates(residual, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-07',
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
    expect(dates(paper, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-06',
      '2026-11-03',
      '2026-12-01',
    ]);
    expect(dates(garden, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-21',
      '2026-11-18',
      '2026-12-16',
    ]);
  });

  it('adds extra dates, even outside a season, and removes exception dates', () => {
    const shifted = schedule({
      ...pmd,
      extraDates: [date('2026-12-24'), date('2027-08-02')],
      exceptionDates: [date('2026-12-22')],
    });
    expect(dates(shifted, '2026-12-01', '2026-12-31')).toEqual(['2026-12-08', '2026-12-24']);
  });

  it('lets an exception date remove an extra date too', () => {
    const cancelled = schedule({
      extraDates: [date('2026-10-10')],
      exceptionDates: [date('2026-10-10')],
    });
    expect(dates(cancelled, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('starts no earlier than the rule does', () => {
    const weekly = schedule({ rules: [{ rrule: 'FREQ=WEEKLY', start: date('2026-10-15') }] });
    expect(dates(weekly, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
  });

  it('merges a date two rules both produce', () => {
    const overlapping = schedule({
      rules: [
        { rrule: 'FREQ=WEEKLY;BYDAY=TU', start: date('2026-10-01') },
        { rrule: 'FREQ=MONTHLY;BYDAY=2TU', start: date('2026-10-01') },
      ],
    });
    expect(dates(overlapping, '2026-10-12', '2026-10-14')).toEqual(['2026-10-13']);
  });
});

describe('dates that do not exist (ADR-0004 §3, clarification)', () => {
  it('moves the 31st to the first day of the next month', () => {
    const monthly = schedule({ rules: [frequencyRule('monthly', date('2026-01-31'))] });
    expect(dates(monthly, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-03-01',
      '2026-03-31',
      '2026-05-01',
      '2026-05-31',
    ]);
  });

  it('moves 29 February to 1 March outside leap years', () => {
    const yearly = schedule({ rules: [frequencyRule('yearly', date('2028-02-29'))] });
    expect(dates(yearly, '2028-01-01', '2030-12-31')).toEqual([
      '2028-02-29',
      '2029-03-01',
      '2030-03-01',
    ]);
  });
});

describe('frequencyRule (ADR-0004 §3)', () => {
  it.each([
    ['daily', ['2026-10-07', '2026-10-08', '2026-10-09']],
    ['weekly', ['2026-10-07', '2026-10-14', '2026-10-21']],
    ['biweekly', ['2026-10-07', '2026-10-21', '2026-11-04']],
    ['monthly', ['2026-10-07', '2026-11-07', '2026-12-07']],
    ['tri-monthly', ['2026-10-07', '2027-01-07', '2027-04-07']],
    ['yearly', ['2026-10-07', '2027-10-07', '2028-10-07']],
  ] as const)('%s', (frequency, expected) => {
    const simple = schedule({ rules: [frequencyRule(frequency, date('2026-10-07'))] });
    expect(dates(simple, '2026-10-01', '2028-12-31').slice(0, 3)).toEqual(expected);
  });
});
