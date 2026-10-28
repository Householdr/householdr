import { describe, expect, it } from 'vitest';
import { newRule, scheduleSoFar, scheduleValues } from './task-schedule';

// The advanced editor's fields, from and to the schedule they show (ADR-0004 §3).

describe('the advanced editor’s fields (ADR-0004 §3)', () => {
  it('show a schedule’s rules and dates, or one new rule from today', () => {
    expect(scheduleValues(undefined, '2026-10-08')).toEqual({
      rules: [newRule('2026-10-08')],
      extraDates: [],
      exceptionDates: [],
    });
    expect(
      scheduleValues(
        {
          rules: [
            { kind: 'weekdays-of-month', every: 2, which: [2, -1], day: 3, start: '2026-10-08' },
            { kind: 'year', start: '2027-03-03' },
          ],
          extraDates: ['2026-12-24'],
          exceptionDates: [],
        },
        '2026-10-08',
      ),
    ).toEqual({
      rules: [
        {
          ...newRule('2026-10-08'),
          kind: 'weekdays-of-month',
          every: '2',
          which: ['2', '-1'],
          day: '3',
        },
        { ...newRule('2027-03-03'), kind: 'year' },
      ],
      extraDates: ['2026-12-24'],
      exceptionDates: [],
    });
  });

  it('give the complete rules and filled-in dates so far, for the words', () => {
    const weekly = { ...newRule('2026-10-08'), days: ['3', '1'] };
    expect(
      scheduleSoFar({
        rules: [
          weekly,
          { ...weekly, days: [] },
          { ...weekly, every: '0' },
          { ...weekly, start: '' },
          { ...newRule('2026-10-08'), kind: 'weekdays-of-month', which: [], day: '2' },
          { ...newRule('2026-10-31'), kind: 'months', every: '2' },
        ],
        extraDates: ['', '2026-12-24'],
        exceptionDates: [''],
      }),
    ).toEqual({
      rules: [
        { kind: 'weeks', every: 1, days: [1, 3], start: '2026-10-08' },
        { kind: 'months', every: 2, start: '2026-10-31' },
      ],
      extraDates: ['2026-12-24'],
      exceptionDates: [],
    });
  });
});
