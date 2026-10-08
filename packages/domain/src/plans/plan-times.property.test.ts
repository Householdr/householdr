import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planWeek, type HouseholdCalendar } from '../schedules/week';
import { duePlanStep, nextPlanWeek, planTimes, type PlanStatus } from './plan-times';

// The scheduler's timing as invariants, in time zones with and without daylight saving (TEST-1,
// TEST-2).

type Weekday = HouseholdCalendar['weekStartDay'];
const calendar: fc.Arbitrary<HouseholdCalendar> = fc.record({
  timeZone: fc.constantFrom('Europe/Brussels', 'Europe/Lisbon', 'Atlantic/Azores', 'UTC'),
  weekStartDay: fc.constantFrom<Weekday>(1, 2, 3, 4, 5, 6, 7),
});
// Any minute over two years, so every change of the clocks comes by.
const instant = fc
  .integer({ min: 0, max: 2 * 366 * 24 * 60 })
  .map((minutes) => Temporal.Instant.from('2026-01-01T00:00:00Z').add({ minutes }));
const timings = fc
  .tuple(fc.integer({ min: 0, max: 96 }), fc.integer({ min: 1, max: 72 }))
  .map(([publish, gap]) => ({ publish, draft: publish + gap }));
const status = fc.constantFrom<PlanStatus | undefined>(undefined, 'draft', 'published');
const startOf = (day: Temporal.PlainDate, c: HouseholdCalendar) =>
  day.toZonedDateTime({ timeZone: c.timeZone }).toInstant();

describe('the scheduler’s timing (ADR-0006 §2, ADR-0008 §10)', () => {
  it('plans the week right after the one now falls in, which starts after now', () => {
    fc.assert(
      fc.property(calendar, instant, (c, now) => {
        const next = nextPlanWeek(now, c);
        const today = now.toZonedDateTimeISO(c.timeZone).toPlainDate();
        expect(planWeek(today, c).end.equals(next.start)).toBe(true);
        expect(Temporal.Instant.compare(startOf(next.start, c), now)).toBeGreaterThan(0);
      }),
    );
  });

  it('drafts before it publishes, and publishes before the week starts', () => {
    fc.assert(
      fc.property(calendar, instant, timings, (c, now, t) => {
        const next = nextPlanWeek(now, c);
        const times = planTimes(next, c, t);
        const start = startOf(next.start, c);
        expect(times.draft.until(times.publish).total('hours')).toBe(t.draft - t.publish);
        expect(times.publish.until(start).total('hours')).toBe(t.publish);
      }),
    );
  });

  it('never takes a step before its time, nor one the plan has had', () => {
    fc.assert(
      fc.property(calendar, instant, timings, status, (c, now, t, plan) => {
        const next = nextPlanWeek(now, c);
        const household = { calendar: c, timings: t, firstWeek: next.start, away: [] };
        const step = duePlanStep(now, next, plan, household);
        const times = planTimes(next, c, t);
        if (step === 'draft') {
          expect(plan).toBeUndefined();
          expect(Temporal.Instant.compare(now, times.draft)).toBeGreaterThanOrEqual(0);
        }
        if (step === 'publish') {
          expect(plan).toBe('draft');
          expect(Temporal.Instant.compare(now, times.publish)).toBeGreaterThanOrEqual(0);
        }
        if (plan === 'published') expect(step).toBeUndefined();
      }),
    );
  });

  it('takes no step for a household in setup', () => {
    fc.assert(
      fc.property(calendar, instant, timings, status, (c, now, t, plan) => {
        const household = { calendar: c, timings: t, firstWeek: undefined, away: [] };
        expect(duePlanStep(now, nextPlanWeek(now, c), plan, household)).toBeUndefined();
      }),
    );
  });

  it('gets a started week published in at most two steps, once its publish time has come', () => {
    fc.assert(
      fc.property(calendar, instant, timings, (c, now, t) => {
        const next = nextPlanWeek(now, c);
        const household = { calendar: c, timings: t, firstWeek: next.start, away: [] };
        const late = planTimes(next, c, t).publish;
        let plan: PlanStatus | undefined;
        for (let steps = 0; steps < 2; steps++) {
          const step = duePlanStep(late, next, plan, household);
          if (step === 'draft') plan = 'draft';
          if (step === 'publish') plan = 'published';
        }
        expect(plan).toBe('published');
        expect(duePlanStep(late, next, plan, household)).toBeUndefined();
      }),
    );
  });
});
