import { describe, expect, it } from 'vitest';
import { frequencyRule } from './frequency';
import { occurrences, oneOffOccurrence, type Occurrence, type Timing } from './occurrence';
import type { Schedule } from './schedule';
import type { HouseholdCalendar } from './week';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const time = (iso: string) => Temporal.PlainTime.from(iso);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const schedule = (parts: Partial<Schedule>): Schedule => ({
  rules: [],
  extraDates: [],
  exceptionDates: [],
  ...parts,
});
const windows = (list: Occurrence[]) =>
  list.map(({ date, window }) => [date.toString(), window.start.toString(), window.end.toString()]);
const at = (local: string, offset: string) => `${local}${offset}[Europe/Brussels]`;
// Monday weeks until 12 October 2026, then a ten-day transition week to Thursday weeks.
const toThursdays: HouseholdCalendar = {
  ...brussels,
  weekStartDay: 4,
  change: { from: date('2026-10-12'), previous: 1 },
};
const days = (list: Occurrence[]) =>
  list.map(({ date, window }) => [
    date.toString(),
    window.start.toPlainDate().toString(),
    window.end.toPlainDate().toString(),
  ]);

describe('fixed windows (ADR-0004 §4)', () => {
  const putOut: Timing = {
    kind: 'fixed',
    from: { dayOffset: -1, time: time('18:00') },
    to: { dayOffset: 0, time: time('07:00') },
  };
  const tuesdays = schedule({
    rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=TU', start: date('2026-01-01') }],
  });

  it('runs from the evening before to the morning of the date', () => {
    expect(
      windows(occurrences(tuesdays, putOut, date('2026-10-27'), date('2026-10-27'), brussels)),
    ).toEqual([
      ['2026-10-27', at('2026-10-26T18:00:00', '+01:00'), at('2026-10-27T07:00:00', '+01:00')],
    ]);
  });

  it('keeps local times across the autumn clock change', () => {
    const sundays = schedule({
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=SU', start: date('2026-01-01') }],
    });
    const [occurrence] = occurrences(
      sundays,
      putOut,
      date('2026-10-25'),
      date('2026-10-25'),
      brussels,
    );
    expect(windows(occurrence ? [occurrence] : [])).toEqual([
      ['2026-10-25', at('2026-10-24T18:00:00', '+02:00'), at('2026-10-25T07:00:00', '+01:00')],
    ]);
    expect(occurrence?.window.start.until(occurrence.window.end).total('hours')).toBe(14);
  });

  it('moves a time that does not exist in the spring gap forward', () => {
    const early: Timing = {
      kind: 'fixed',
      from: { dayOffset: 0, time: time('02:30') },
      to: { dayOffset: 0, time: time('09:00') },
    };
    const sundays = schedule({
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=SU', start: date('2026-01-01') }],
    });
    expect(
      windows(occurrences(sundays, early, date('2026-03-29'), date('2026-03-29'), brussels)),
    ).toEqual([
      ['2026-03-29', at('2026-03-29T03:30:00', '+02:00'), at('2026-03-29T09:00:00', '+02:00')],
    ]);
  });

  it('refuses a window that ends before it starts', () => {
    const backwards: Timing = {
      kind: 'fixed',
      from: { dayOffset: 0, time: time('12:00') },
      to: { dayOffset: 0, time: time('08:00') },
    };
    expect(() =>
      occurrences(tuesdays, backwards, date('2026-10-27'), date('2026-10-27'), brussels),
    ).toThrow(RangeError);
  });
});

describe('flexible windows (ADR-0004 §4)', () => {
  const wednesdays = schedule({ rules: [frequencyRule('weekly', date('2026-10-07'))] });

  it('is the plan week of the date', () => {
    expect(
      windows(
        occurrences(
          wednesdays,
          { kind: 'flexible' },
          date('2026-10-01'),
          date('2026-10-14'),
          brussels,
        ),
      ),
    ).toEqual([
      ['2026-10-07', at('2026-10-05T00:00:00', '+02:00'), at('2026-10-12T00:00:00', '+02:00')],
      ['2026-10-14', at('2026-10-12T00:00:00', '+02:00'), at('2026-10-19T00:00:00', '+02:00')],
    ]);
  });

  it('follows the household week start day', () => {
    const sundayWeeks: HouseholdCalendar = { ...brussels, weekStartDay: 7 };
    const [occurrence] = occurrences(
      wednesdays,
      { kind: 'flexible' },
      date('2026-10-07'),
      date('2026-10-07'),
      sundayWeeks,
    );
    expect(occurrence?.window.start.toString()).toBe(at('2026-10-04T00:00:00', '+02:00'));
  });

  it('is the whole transition week when the start day changes (ADR-0006 §1)', () => {
    expect(
      days(
        occurrences(
          wednesdays,
          { kind: 'flexible' },
          date('2026-10-07'),
          date('2026-10-28'),
          toThursdays,
        ),
      ),
    ).toEqual([
      ['2026-10-07', '2026-10-05', '2026-10-12'],
      ['2026-10-14', '2026-10-12', '2026-10-22'],
      ['2026-10-21', '2026-10-12', '2026-10-22'],
      ['2026-10-28', '2026-10-22', '2026-10-29'],
    ]);
  });

  it('lasts seven days and an hour in the week the clocks go back', () => {
    const [occurrence] = occurrences(
      wednesdays,
      { kind: 'flexible' },
      date('2026-10-21'),
      date('2026-10-21'),
      brussels,
    );
    expect(occurrence?.window.start.until(occurrence.window.end).total('hours')).toBe(7 * 24 + 1);
  });
});

describe('floating windows (ADR-0004 §4, clarification)', () => {
  const floating: Timing = { kind: 'floating' };
  const window = (s: Schedule, d: string) => {
    const [occurrence] = occurrences(s, floating, date(d), date(d), brussels);
    return [
      occurrence?.window.start.toPlainDate().toString(),
      occurrence?.window.end.toPlainDate().toString(),
    ];
  };

  it('floats in whole plan weeks until the week of the next occurrence', () => {
    const monthly = schedule({ rules: [frequencyRule('monthly', date('2026-10-07'))] });
    expect(window(monthly, '2026-10-07')).toEqual(['2026-10-05', '2026-11-02']);
  });

  it('floats a yearly task for a year', () => {
    const yearly = schedule({ rules: [frequencyRule('yearly', date('2026-10-07'))] });
    expect(window(yearly, '2026-10-07')).toEqual(['2026-10-05', '2027-10-04']);
  });

  it('stops at the rule spacing instead of floating through an off-season', () => {
    const seasonal = schedule({
      rules: [
        {
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=10',
          start: date('2026-01-01'),
          season: {
            from: Temporal.PlainMonthDay.from('09-01'),
            to: Temporal.PlainMonthDay.from('06-30'),
          },
        },
      ],
    });
    expect(window(seasonal, '2027-06-10')).toEqual(['2027-06-07', '2027-07-05']);
  });

  it('floats four weeks after the last date of an ended rule', () => {
    const twice = schedule({
      rules: [{ rrule: 'FREQ=MONTHLY;COUNT=2', start: date('2026-10-07') }],
    });
    expect(window(twice, '2026-10-07')).toEqual(['2026-10-05', '2026-11-02']);
    expect(window(twice, '2026-11-07')).toEqual(['2026-11-02', '2026-11-30']);
  });

  it('floats an extra date four weeks, or until the next occurrence', () => {
    expect(window(schedule({ extraDates: [date('2026-10-14')] }), '2026-10-14')).toEqual([
      '2026-10-12',
      '2026-11-09',
    ]);
    expect(
      window(schedule({ extraDates: [date('2026-10-14'), date('2026-10-28')] }), '2026-10-14'),
    ).toEqual(['2026-10-12', '2026-10-26']);
  });

  it('always covers at least its own week', () => {
    const sameWeek = schedule({ extraDates: [date('2026-10-07'), date('2026-10-09')] });
    expect(window(sameWeek, '2026-10-07')).toEqual(['2026-10-05', '2026-10-12']);
  });

  it('counts a transition week as one of its weeks (ADR-0006 §1)', () => {
    const floatIn = (s: Schedule, d: string) =>
      days(occurrences(s, floating, date(d), date(d), toThursdays));
    const monthly = schedule({ rules: [frequencyRule('monthly', date('2026-10-07'))] });
    expect(floatIn(monthly, '2026-10-07')).toEqual([['2026-10-07', '2026-10-05', '2026-11-05']]);
    expect(floatIn(schedule({ extraDates: [date('2026-10-07')] }), '2026-10-07')).toEqual([
      ['2026-10-07', '2026-10-05', '2026-11-05'],
    ]);
    expect(floatIn(schedule({ extraDates: [date('2026-10-14')] }), '2026-10-14')).toEqual([
      ['2026-10-14', '2026-10-12', '2026-11-12'],
    ]);
    const sameWeek = schedule({ extraDates: [date('2026-10-14'), date('2026-10-20')] });
    expect(floatIn(sameWeek, '2026-10-14')).toEqual([['2026-10-14', '2026-10-12', '2026-10-22']]);
  });
});

describe('one-off tasks (ADR-0004 §4)', () => {
  it('is flexible within its week without a deadline', () => {
    const { window } = oneOffOccurrence(date('2026-10-07'), undefined, brussels);
    expect([window.start.toString(), window.end.toString()]).toEqual([
      at('2026-10-05T00:00:00', '+02:00'),
      at('2026-10-12T00:00:00', '+02:00'),
    ]);
  });

  it('floats until the end of its deadline', () => {
    const { window } = oneOffOccurrence(date('2026-10-07'), date('2026-10-20'), brussels);
    expect([window.start.toString(), window.end.toString()]).toEqual([
      at('2026-10-05T00:00:00', '+02:00'),
      at('2026-10-21T00:00:00', '+02:00'),
    ]);
  });

  it('takes the transition week as its week (ADR-0006 §1)', () => {
    const plain = oneOffOccurrence(date('2026-10-14'), undefined, toThursdays);
    const due = oneOffOccurrence(date('2026-10-14'), date('2026-10-25'), toThursdays);
    expect(days([plain, due])).toEqual([
      ['2026-10-14', '2026-10-12', '2026-10-22'],
      ['2026-10-14', '2026-10-12', '2026-10-26'],
    ]);
  });

  it('refuses a deadline before its date', () => {
    expect(() => oneOffOccurrence(date('2026-10-07'), date('2026-10-06'), brussels)).toThrow(
      RangeError,
    );
  });
});
