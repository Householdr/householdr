import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { isEligible, type Candidate, type Constraint, type TaskRules } from './eligibility';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const adult: Candidate = {
  id: 'ann',
  fairFraction: 0.5,
  availability: { absences: [], unavailable: [] },
};
const child = (birthDate: string): Candidate => ({
  ...adult,
  id: 'sam',
  birthDate: date(birthDate),
});
const task = (minimumAge?: number, constraints: [string, Constraint][] = []): TaskRules => ({
  ...(minimumAge === undefined ? {} : { minimumAge }),
  constraints: new Map(constraints),
});

// Tuesday 13 October 2026, 18:00 to 22:00, in the week of Monday 12 October.
const evening = { start: at('2026-10-13T18:00'), end: at('2026-10-13T22:00') };
const week = date('2026-10-13');
const eligible = (member: Candidate, rules: TaskRules) =>
  isEligible(member, rules, evening, week, brussels);

describe('isEligible (ADR-0001 §7)', () => {
  it('lets anyone take a task without rules', () => {
    expect(eligible(adult, task())).toBe(true);
  });

  it('never gives an excluded task', () => {
    expect(eligible(adult, task(undefined, [['ann', 'excluded']]))).toBe(false);
    expect(eligible(adult, task(undefined, [['bob', 'excluded']]))).toBe(true);
  });

  it('gives nothing to a member with a share of 0, bound tasks included', () => {
    const none = { ...adult, fairFraction: 0 };
    expect(eligible(none, task())).toBe(false);
    expect(eligible(none, task(undefined, [['ann', 'bound']]))).toBe(false);
  });

  it('checks the minimum age in whole years on the first day of the plan week', () => {
    expect(eligible(child('2014-10-12'), task(12))).toBe(true);
    // Turns 12 on Tuesday 13 October: still 11 on Monday, so not this week.
    expect(eligible(child('2014-10-13'), task(12))).toBe(false);
    // With weeks starting on Tuesday, the week begins on the birthday.
    expect(
      isEligible(child('2014-10-13'), task(12), evening, week, { ...brussels, weekStartDay: 2 }),
    ).toBe(true);
  });

  it('takes the first day of a transition week as its first day (ADR-0006 §1)', () => {
    // Monday weeks to Thursday weeks from Monday 12 October: a ten-day week to Thursday 22.
    const thursdays: HouseholdCalendar = { ...brussels, weekStartDay: 4 };
    const toThursdays: HouseholdCalendar = {
      ...thursdays,
      change: { from: date('2026-10-12'), previous: 1 },
    };
    const tuesday = { start: at('2026-10-20T18:00'), end: at('2026-10-20T22:00') };
    // Turns 12 on Wednesday 14 October: 11 when the transition week starts.
    const turnsTwelve = child('2014-10-14');
    const check = (calendar: HouseholdCalendar) =>
      isEligible(turnsTwelve, task(12), tuesday, date('2026-10-20'), calendar);
    expect(check(toThursdays)).toBe(false);
    expect(check(thursdays)).toBe(true);
  });

  it('lets a head allow a younger child, or bind them', () => {
    const young = child('2018-01-01');
    expect(eligible(young, task(12))).toBe(false);
    expect(eligible(young, task(12, [['sam', 'allowed']]))).toBe(true);
    expect(eligible(young, task(12, [['sam', 'bound']]))).toBe(true);
  });

  it('has no age limit for adults, who have no birth date', () => {
    expect(eligible(adult, task(16))).toBe(true);
  });

  it('needs the member here for some part of the window', () => {
    const until19 = {
      ...adult,
      availability: {
        absences: [],
        unavailable: [{ start: at('2026-10-13T08:00'), end: at('2026-10-13T19:00') }],
      },
    };
    const allEvening = {
      ...adult,
      availability: {
        absences: [{ from: date('2026-10-13'), to: date('2026-10-13') }],
        unavailable: [],
      },
    };
    expect(eligible(until19, task())).toBe(true);
    expect(eligible(allEvening, task())).toBe(false);
    expect(eligible(allEvening, task(undefined, [['ann', 'bound']]))).toBe(false);
  });
});
