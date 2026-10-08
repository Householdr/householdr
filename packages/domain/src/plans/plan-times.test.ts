import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar, PlanWeek } from '../schedules/week';
import {
  defaultPlanTimings,
  duePlanStep,
  nextPlanWeek,
  planTimes,
  type ScheduledHousehold,
} from './plan-times';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const instant = (iso: string) => Temporal.Instant.from(iso);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const week = (start: string, days = 7): PlanWeek => ({
  start: date(start),
  end: date(start).add({ days }),
});
const shown = (w: PlanWeek) => [w.start.toString(), w.end.toString()];
const local = (at: Temporal.Instant, timeZone = 'Europe/Brussels') =>
  at.toZonedDateTimeISO(timeZone).toPlainDateTime().toString();

describe('nextPlanWeek (ADR-0006 §1–§2)', () => {
  it('is the week after the one now falls in, in the household’s time zone', () => {
    // Thursday 8 October 2026, 10:00 in Brussels.
    expect(shown(nextPlanWeek(instant('2026-10-08T08:00:00Z'), brussels))).toEqual([
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('moves on at midnight in the household’s time zone, not in UTC', () => {
    // 23:30 on Sunday 11 October in UTC is already Monday in Brussels, still Sunday in the Azores.
    const now = instant('2026-10-11T23:30:00Z');
    expect(shown(nextPlanWeek(now, brussels))).toEqual(['2026-10-19', '2026-10-26']);
    const azores = { ...brussels, timeZone: 'Atlantic/Azores' };
    expect(shown(nextPlanWeek(now, azores))).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('follows the week start day, and a transition week after a change of it', () => {
    const sundays: HouseholdCalendar = { ...brussels, weekStartDay: 7 };
    expect(shown(nextPlanWeek(instant('2026-10-08T08:00:00Z'), sundays))).toEqual([
      '2026-10-11',
      '2026-10-18',
    ]);
    // From Monday weeks to Thursday weeks from 19 October: a transition week of 10 days.
    const changing: HouseholdCalendar = {
      ...brussels,
      weekStartDay: 4,
      change: { from: date('2026-10-19'), previous: 1 },
    };
    expect(shown(nextPlanWeek(instant('2026-10-15T08:00:00Z'), changing))).toEqual([
      '2026-10-19',
      '2026-10-29',
    ]);
  });
});

describe('planTimes (ADR-0006 §2)', () => {
  it('drafts 48 hours and publishes 12 hours before the week starts, by default', () => {
    const times = planTimes(week('2026-10-12'), brussels, defaultPlanTimings);
    expect(local(times.draft)).toBe('2026-10-10T00:00:00');
    expect(local(times.publish)).toBe('2026-10-11T12:00:00');
  });

  it('follows the household’s own timings', () => {
    const times = planTimes(week('2026-10-12'), brussels, { draft: 72, publish: 1 });
    expect(local(times.draft)).toBe('2026-10-09T00:00:00');
    expect(local(times.publish)).toBe('2026-10-11T23:00:00');
  });

  it('counts elapsed hours when the clocks go back in the weekend before (TEST-2)', () => {
    // The clocks go back at 03:00 on Sunday 25 October 2026: that day has 25 hours.
    const times = planTimes(week('2026-10-26'), brussels, defaultPlanTimings);
    expect(times.draft.toString()).toBe('2026-10-23T23:00:00Z');
    expect(local(times.draft)).toBe('2026-10-24T01:00:00');
    expect(local(times.publish)).toBe('2026-10-25T12:00:00');
  });

  it('counts elapsed hours when the clocks go forward in the weekend before (TEST-2)', () => {
    // The clocks go forward at 02:00 on Sunday 29 March 2026: that day has 23 hours.
    const times = planTimes(week('2026-03-30'), brussels, defaultPlanTimings);
    expect(times.draft.toString()).toBe('2026-03-27T22:00:00Z');
    expect(local(times.draft)).toBe('2026-03-27T23:00:00');
    expect(local(times.publish)).toBe('2026-03-29T12:00:00');
  });

  it('starts the week at midnight where the household is', () => {
    const lisbon = { ...brussels, timeZone: 'Europe/Lisbon' };
    const times = planTimes(week('2026-10-12'), lisbon, defaultPlanTimings);
    expect(times.publish.toString()).toBe('2026-10-11T11:00:00Z');
    expect(local(times.publish, 'Europe/Lisbon')).toBe('2026-10-11T12:00:00');
  });
});

describe('duePlanStep (ADR-0006 §2, ADR-0008 §10)', () => {
  const next = week('2026-10-12');
  const started: ScheduledHousehold = {
    calendar: brussels,
    timings: defaultPlanTimings,
    firstWeek: date('2026-10-12'),
    away: [],
  };
  // Saturday 10 October 00:00 and Sunday 11 October 12:00 in Brussels.
  const draftTime = instant('2026-10-09T22:00:00Z');
  const publishTime = instant('2026-10-11T10:00:00Z');
  const second = { seconds: 1 };

  it('drafts the week once its draft time has come, and not before', () => {
    expect(duePlanStep(draftTime.subtract(second), next, undefined, started)).toBeUndefined();
    expect(duePlanStep(draftTime, next, undefined, started)).toBe('draft');
    expect(duePlanStep(publishTime.subtract(second), next, undefined, started)).toBe('draft');
  });

  it('publishes the draft once its publish time has come, and not before', () => {
    expect(duePlanStep(publishTime.subtract(second), next, 'draft', started)).toBeUndefined();
    expect(duePlanStep(publishTime, next, 'draft', started)).toBe('publish');
  });

  it('drafts first when the publish time came before any draft, as after a missed tick', () => {
    expect(duePlanStep(publishTime.add({ hours: 1 }), next, undefined, started)).toBe('draft');
  });

  it('does nothing more once the plan is published (ADR-0006 §3)', () => {
    expect(duePlanStep(publishTime.add({ hours: 1 }), next, 'published', started)).toBeUndefined();
  });

  it('does nothing for a household in setup (ADR-0007 §2)', () => {
    const inSetup = { ...started, firstWeek: undefined };
    for (const plan of [undefined, 'draft'] as const) {
      expect(duePlanStep(publishTime, next, plan, inSetup)).toBeUndefined();
    }
  });

  it('starts with the household’s first plan week', () => {
    const later = { ...started, firstWeek: date('2026-10-19') };
    expect(duePlanStep(publishTime, next, undefined, later)).toBeUndefined();
    const earlier = { ...started, firstWeek: date('2026-10-05') };
    expect(duePlanStep(publishTime, next, undefined, earlier)).toBe('draft');
  });

  it('plans no week the household is away for entirely, but one it is partly away (ADR-0005 §5)', () => {
    const allWeek = { ...started, away: [{ from: date('2026-10-10'), to: date('2026-10-18') }] };
    expect(duePlanStep(publishTime, next, undefined, allWeek)).toBeUndefined();
    expect(duePlanStep(publishTime, next, 'draft', allWeek)).toBeUndefined();
    const split = {
      ...started,
      away: [
        { from: date('2026-10-12'), to: date('2026-10-14') },
        { from: date('2026-10-16'), to: date('2026-10-18') },
      ],
    };
    expect(duePlanStep(publishTime, next, undefined, split)).toBe('draft');
    expect(duePlanStep(publishTime, next, 'draft', split)).toBe('publish');
  });

  it('follows the household’s time zone', () => {
    const lisbon = {
      ...started,
      calendar: { ...brussels, timeZone: 'Europe/Lisbon' },
    };
    // 23:30 on Friday in Lisbon is already Saturday in Brussels.
    const now = instant('2026-10-09T22:30:00Z');
    expect(duePlanStep(now, next, undefined, started)).toBe('draft');
    expect(duePlanStep(now, next, undefined, lisbon)).toBeUndefined();
  });
});
