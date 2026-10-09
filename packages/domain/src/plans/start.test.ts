import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar, PlanWeek } from '../schedules/week';
import { comingPlanTimes, defaultStart, firstPlanWeek } from './start';

const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const shown = (week: PlanWeek) => [week.start.toString(), week.end.toString()];
const instant = (iso: string) => Temporal.Instant.from(iso);

describe('firstPlanWeek (ADR-0007 §3)', () => {
  // Thursday 8 October 2026, 10:00 in Brussels.
  const thursday = instant('2026-10-08T08:00:00Z');

  it('is this plan week to start now, and the next one to start on the week start day', () => {
    expect(shown(firstPlanWeek('now', thursday, brussels))).toEqual(['2026-10-05', '2026-10-12']);
    expect(shown(firstPlanWeek('week start', thursday, brussels))).toEqual([
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('starts now unless the head chooses otherwise (ADR-0007 §2)', () => {
    expect(defaultStart).toBe('now');
  });

  it('is the whole of this week to start now on its first day', () => {
    // Monday 12 October, 09:00 in Brussels.
    const monday = instant('2026-10-12T07:00:00Z');
    expect(shown(firstPlanWeek('now', monday, brussels))).toEqual(['2026-10-12', '2026-10-19']);
    expect(shown(firstPlanWeek('week start', monday, brussels))).toEqual([
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  it('follows the household’s time zone and start day', () => {
    // 23:30 on Sunday 11 October in Lisbon, and already Monday in Brussels.
    const late = instant('2026-10-11T22:30:00Z');
    const lisbon: HouseholdCalendar = { timeZone: 'Europe/Lisbon', weekStartDay: 1 };
    expect(shown(firstPlanWeek('now', late, brussels))).toEqual(['2026-10-12', '2026-10-19']);
    expect(shown(firstPlanWeek('now', late, lisbon))).toEqual(['2026-10-05', '2026-10-12']);
    const sundays: HouseholdCalendar = { ...brussels, weekStartDay: 7 };
    expect(shown(firstPlanWeek('now', thursday, sundays))).toEqual(['2026-10-04', '2026-10-11']);
    expect(shown(firstPlanWeek('week start', thursday, sundays))).toEqual([
      '2026-10-11',
      '2026-10-18',
    ]);
  });
});

describe('comingPlanTimes (ADR-0006 §2, ADR-0008 §10)', () => {
  const week = {
    start: Temporal.PlainDate.from('2026-10-12'),
    end: Temporal.PlainDate.from('2026-10-19'),
  };
  const timings = { draft: 48, publish: 12 };
  const shownTimes = (now: string) => {
    const times = comingPlanTimes(instant(now), week, brussels, timings);
    return [times.draft.toString(), times.publish.toString()];
  };

  it('is when the week is drafted and published, while both are to come', () => {
    // Saturday 10 October 00:00 and Sunday 11 October 12:00 in Brussels.
    expect(shownTimes('2026-10-08T08:00:00Z')).toEqual([
      '2026-10-09T22:00:00Z',
      '2026-10-11T10:00:00Z',
    ]);
  });

  it('is now for a step whose time has passed, which the scheduler takes at once', () => {
    expect(shownTimes('2026-10-10T08:00:00Z')).toEqual([
      '2026-10-10T08:00:00Z',
      '2026-10-11T10:00:00Z',
    ]);
    expect(shownTimes('2026-10-11T11:00:00Z')).toEqual([
      '2026-10-11T11:00:00Z',
      '2026-10-11T11:00:00Z',
    ]);
  });
});
