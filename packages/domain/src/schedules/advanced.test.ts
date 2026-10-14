import { describe, expect, it } from 'vitest';
import {
  advancedRule,
  advancedRuleOf,
  advancedScheduleOf,
  isAdvancedRule,
  isAdvancedSchedule,
  isScheduleDate,
  scheduleOfAdvanced,
  type AdvancedRule,
  type AdvancedSchedule,
} from './advanced';
import { expand } from './expand';
import { frequencyOf } from './frequency';

// The rules of the advanced editor (ADR-0004 §3, clarifications), from examples (TEST-1).

const date = (iso: string) => Temporal.PlainDate.from(iso);
const start = date('2026-10-15');

const dates = (advanced: Partial<AdvancedSchedule>, from: string, to: string) =>
  expand(
    scheduleOfAdvanced({ rules: [], extraDates: [], exceptionDates: [], ...advanced }),
    date(from),
    date(to),
  ).map((d) => d.toString());

describe('advancedRule (ADR-0004 §3)', () => {
  it('compiles each kind to a rule, with its days in order', () => {
    const cases: [AdvancedRule, string][] = [
      [{ kind: 'weeks', every: 1, days: [3], start }, 'FREQ=WEEKLY;BYDAY=WE'],
      [{ kind: 'weeks', every: 2, days: [4, 1], start }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'],
      [{ kind: 'months', every: 2, start }, 'FREQ=MONTHLY;INTERVAL=2'],
      [
        { kind: 'weekdays-of-month', every: 1, which: [4, 2], day: 2, start },
        'FREQ=MONTHLY;BYDAY=2TU,4TU',
      ],
      [
        { kind: 'weekdays-of-month', every: 3, which: [-1, 1], day: 5, start },
        'FREQ=MONTHLY;INTERVAL=3;BYDAY=1FR,-1FR',
      ],
      [{ kind: 'year', start }, 'FREQ=YEARLY'],
    ];
    for (const [rule, rrule] of cases) expect(advancedRule(rule)).toEqual({ rrule, start });
  });

  it('expresses the waste calendar the ADR tests itself with, without seasons', () => {
    const pmd = { kind: 'weekdays-of-month', every: 1, which: [2, 4], day: 2, start } as const;
    const residual = { kind: 'weeks', every: 1, days: [3], start } as const;
    expect(dates({ rules: [pmd, residual] }, '2026-10-15', '2026-11-15')).toEqual([
      '2026-10-21',
      '2026-10-27',
      '2026-10-28',
      '2026-11-04',
      '2026-11-10',
      '2026-11-11',
    ]);
  });

  it('counts every N weeks from the week of its first time', () => {
    const rule = { kind: 'weeks', every: 2, days: [1, 4], start } as const;
    expect(dates({ rules: [rule] }, '2026-10-12', '2026-11-12')).toEqual([
      '2026-10-15',
      '2026-10-26',
      '2026-10-29',
      '2026-11-09',
      '2026-11-12',
    ]);
  });

  it('repeats every N months on the day of its first time, moving a day that does not exist', () => {
    const rule = { kind: 'months', every: 1, start: date('2027-01-31') } as const;
    expect(dates({ rules: [rule] }, '2027-01-01', '2027-04-30')).toEqual([
      '2027-01-31',
      '2027-03-01',
      '2027-03-31',
    ]);
  });

  it('takes the last of a weekday in its month', () => {
    const rule = { kind: 'weekdays-of-month', every: 1, which: [-1], day: 5, start } as const;
    expect(dates({ rules: [rule] }, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-30',
      '2026-11-27',
      '2026-12-25',
    ]);
  });

  it('adds extra dates and leaves out exception dates', () => {
    const rule = { kind: 'weeks', every: 1, days: [3], start } as const;
    const advanced = {
      rules: [rule],
      extraDates: [date('2026-11-12')],
      exceptionDates: [date('2026-11-11')],
    };
    expect(dates(advanced, '2026-11-01', '2026-11-20')).toEqual([
      '2026-11-04',
      '2026-11-12',
      '2026-11-18',
    ]);
  });
});

describe('advancedRuleOf (ADR-0004 §3)', () => {
  it('reads back what advancedRule compiles', () => {
    const rules: AdvancedRule[] = [
      { kind: 'weeks', every: 3, days: [1, 6, 7], start },
      { kind: 'months', every: 12, start },
      { kind: 'weekdays-of-month', every: 2, which: [1, 3, -1], day: 7, start },
      { kind: 'year', start },
    ];
    for (const rule of rules) expect(advancedRuleOf(advancedRule(rule))).toEqual(rule);
  });

  it('reads a simple frequency on a schedule date as the same kind', () => {
    expect(advancedRuleOf({ rrule: 'FREQ=MONTHLY;INTERVAL=3', start })).toEqual({
      kind: 'months',
      every: 3,
      start,
    });
  });

  it('is none for a rule beyond the editor', () => {
    const summer = {
      from: Temporal.PlainMonthDay.from('07-01'),
      to: Temporal.PlainMonthDay.from('08-31'),
    };
    for (const rule of [
      { rrule: 'FREQ=DAILY', start },
      { rrule: 'FREQ=WEEKLY', start },
      { rrule: 'FREQ=WEEKLY;BYDAY=XX', start },
      { rrule: 'FREQ=MONTHLY;BYDAY=2TU,4WE', start },
      { rrule: 'FREQ=MONTHLY;BYDAY=5TU', start },
      { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', start },
      { rrule: 'FREQ=YEARLY;INTERVAL=2', start },
      { rrule: 'FREQ=WEEKLY;INTERVAL=0;BYDAY=MO', start },
      { rrule: 'FREQ=WEEKLY;BYDAY=TU', start, season: summer },
    ]) {
      expect(advancedRuleOf(rule)).toBeUndefined();
    }
  });

  it('reads a whole schedule back, or none of it', () => {
    const weekly = { kind: 'weeks', every: 1, days: [2], start } as const;
    const advanced = { rules: [weekly], extraDates: [start], exceptionDates: [] };
    expect(advancedScheduleOf(scheduleOfAdvanced(advanced))).toEqual(advanced);
    const daily = { rrule: 'FREQ=DAILY', start };
    expect(
      advancedScheduleOf({ ...scheduleOfAdvanced(advanced), rules: [advancedRule(weekly), daily] }),
    ).toBeUndefined();
  });

  it('leaves a schedule that is exactly a simple frequency to be read as one', () => {
    const monthly = { kind: 'months', every: 1, start } as const;
    const schedule = scheduleOfAdvanced({ rules: [monthly], extraDates: [], exceptionDates: [] });
    expect(frequencyOf(schedule)).toBe('monthly');
  });
});

describe('isAdvancedRule (ADR-0004 §3, clarification)', () => {
  it('takes N from 1 to 52 weeks and 1 to 12 months', () => {
    const weeks = (every: number) => isAdvancedRule({ kind: 'weeks', every, days: [1], start });
    const months = (every: number) => isAdvancedRule({ kind: 'months', every, start });
    expect([weeks(1), weeks(52), months(1), months(12)]).toEqual([true, true, true, true]);
    expect([weeks(0), weeks(53), weeks(1.5), months(13)]).toEqual([false, false, false, false]);
  });

  it('needs at least one day, each once', () => {
    const weeks = (days: Extract<AdvancedRule, { kind: 'weeks' }>['days']) =>
      isAdvancedRule({ kind: 'weeks', every: 1, days, start });
    expect([weeks([]), weeks([2, 2]), weeks([2, 3])]).toEqual([false, false, true]);
    const which = (list: Extract<AdvancedRule, { kind: 'weekdays-of-month' }>['which']) =>
      isAdvancedRule({ kind: 'weekdays-of-month', every: 1, which: list, day: 2, start });
    expect([which([]), which([-1, -1]), which([1, -1])]).toEqual([false, false, true]);
  });
});

describe('isAdvancedSchedule (ADR-0004 §3, clarifications)', () => {
  const weekly = { kind: 'weeks', every: 1, days: [2], start } as const;
  const days = (count: number) => Array.from({ length: count }, (_, i) => start.add({ days: i }));

  it('takes up to five rules and up to 50 dates of each kind', () => {
    const at = (rules: number, extra: number, exceptions: number) =>
      isAdvancedSchedule({
        rules: Array.from<AdvancedRule>({ length: rules }).fill(weekly),
        extraDates: days(extra),
        exceptionDates: days(exceptions),
      });
    expect(at(5, 50, 50)).toBe(true);
    expect(at(6, 0, 0)).toBe(false);
    expect(at(1, 51, 0)).toBe(false);
    expect(at(1, 0, 51)).toBe(false);
  });

  it('needs a rule or an extra date', () => {
    const at = (advanced: Partial<AdvancedSchedule>) =>
      isAdvancedSchedule({ rules: [], extraDates: [], exceptionDates: [], ...advanced });
    expect(at({})).toBe(false);
    expect(at({ exceptionDates: [start] })).toBe(false);
    expect(at({ extraDates: [start] })).toBe(true);
    expect(at({ rules: [weekly] })).toBe(true);
  });

  it('takes each date once', () => {
    const at = (advanced: Partial<AdvancedSchedule>) =>
      isAdvancedSchedule({ rules: [weekly], extraDates: [], exceptionDates: [], ...advanced });
    expect(at({ extraDates: [start, date('2026-10-15')] })).toBe(false);
    expect(at({ exceptionDates: [start, date('2026-10-15')] })).toBe(false);
  });
});

describe('isScheduleDate (ADR-0004 §3, clarifications)', () => {
  const today = date('2026-10-13');

  it('takes a day from today up to two years on', () => {
    expect(isScheduleDate(today, today)).toBe(true);
    expect(isScheduleDate(date('2028-10-13'), today)).toBe(true);
    expect(isScheduleDate(date('2026-10-12'), today)).toBe(false);
    expect(isScheduleDate(date('2028-10-14'), today)).toBe(false);
  });

  it('keeps a date the schedule has already, even once passed', () => {
    expect(isScheduleDate(date('2026-01-01'), today, [date('2026-01-01')])).toBe(true);
    expect(isScheduleDate(date('2026-01-02'), today, [date('2026-01-01')])).toBe(false);
  });
});
