import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { frequencyRule, type Frequency } from './frequency';
import { occurrences, type Timing } from './occurrence';
import type { Schedule } from './schedule';
import { planWeek, type HouseholdCalendar } from './week';

// Invariants of occurrence windows over generated schedules, timings and households (TEST-1),
// including zones with daylight saving at midnight and in the southern hemisphere (TEST-2), and
// households that change their week start day (ADR-0006 §1).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = fc.integer({ min: 0, max: 2 * 366 }).map((n) => origin.add({ days: n }));
const frequency = fc.constantFrom<Frequency>(
  'weekly',
  'biweekly',
  'monthly',
  'tri-monthly',
  'yearly',
);
const schedule: fc.Arbitrary<Schedule> = fc.record({
  rules: fc.array(
    fc
      .record({ frequency, start: day })
      .map(({ frequency, start }) => frequencyRule(frequency, start)),
    { maxLength: 2 },
  ),
  extraDates: fc.array(day, { maxLength: 3 }),
  exceptionDates: fc.array(day, { maxLength: 2 }),
});
type Weekday = HouseholdCalendar['weekStartDay'];
const weekday = fc.constantFrom<Weekday>(1, 2, 3, 4, 5, 6, 7);
const calendar: fc.Arbitrary<HouseholdCalendar> = fc
  .tuple(
    fc.constantFrom(
      'Europe/Brussels',
      'America/New_York',
      'America/Santiago',
      'Australia/Sydney',
      'Asia/Kolkata',
      'UTC',
    ),
    weekday,
    fc.option(fc.tuple(weekday, day), { nil: undefined }),
  )
  .map(([timeZone, weekStartDay, change]) => {
    if (!change || change[0] === weekStartDay) return { timeZone, weekStartDay };
    const [previous, near] = change;
    const from = near.subtract({ days: (near.dayOfWeek - previous + 7) % 7 });
    return { timeZone, weekStartDay, change: { from, previous } };
  });
const plainTime = fc
  .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.constantFrom(0, 15, 30, 45) })
  .map((t) => Temporal.PlainTime.from(t));
const fixed: fc.Arbitrary<Timing> = fc
  .record({
    fromDay: fc.integer({ min: -2, max: 0 }),
    from: plainTime,
    extraDays: fc.integer({ min: 1, max: 2 }),
    to: plainTime,
  })
  .map(({ fromDay, from, extraDays, to }) => ({
    kind: 'fixed',
    from: { dayOffset: fromDay, time: from },
    to: { dayOffset: fromDay + extraDays, time: to },
  }));
const timing: fc.Arbitrary<Timing> = fc.oneof(
  fc.constant<Timing>({ kind: 'flexible' }),
  fc.constant<Timing>({ kind: 'floating' }),
  fixed,
);
const range = fc
  .tuple(day, fc.integer({ min: 0, max: 120 }))
  .map(([from, days]): [Temporal.PlainDate, Temporal.PlainDate] => [from, from.add({ days })]);

describe('occurrence window invariants (ADR-0004 §4, §6)', () => {
  it('gives every occurrence a window that ends after it starts', () => {
    fc.assert(
      fc.property(schedule, timing, range, calendar, (s, t, [from, to], c) => {
        for (const { window } of occurrences(s, t, from, to, c)) {
          expect(Temporal.ZonedDateTime.compare(window.start, window.end)).toBe(-1);
        }
      }),
    );
  });

  it('places flexible and floating windows on whole plan weeks, starting with the date’s week', () => {
    fc.assert(
      fc.property(
        schedule,
        fc.constantFrom<Timing>({ kind: 'flexible' }, { kind: 'floating' }),
        range,
        calendar,
        (s, t, [from, to], c) => {
          for (const { date, window } of occurrences(s, t, from, to, c)) {
            const start = window.start.toPlainDate();
            const end = window.end.toPlainDate();
            const own = planWeek(date, c);
            expect(start.equals(own.start)).toBe(true);
            expect(planWeek(end, c).start.equals(end)).toBe(true);
            if (t.kind === 'flexible') expect(end.equals(own.end)).toBe(true);
            else expect(Temporal.PlainDate.compare(end, own.end)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it('never floats into the week of the next occurrence, unless they share a week', () => {
    fc.assert(
      fc.property(schedule, range, calendar, (s, [from, to], c) => {
        const list = occurrences(s, { kind: 'floating' }, from, to, c);
        list.forEach(({ date, window }, i) => {
          const next = list[i + 1];
          if (!next) return;
          const nextWeek = planWeek(next.date, c).start;
          const sameWeek = nextWeek.equals(planWeek(date, c).start);
          if (!sameWeek)
            expect(
              Temporal.PlainDate.compare(window.end.toPlainDate(), nextWeek),
            ).toBeLessThanOrEqual(0);
        });
      }),
    );
  });

  it('starts a fixed window at its local time, or later only when that time does not exist', () => {
    fc.assert(
      fc.property(schedule, fixed, range, calendar, (s, t, [from, to], c) => {
        if (t.kind !== 'fixed') return;
        for (const { date, window } of occurrences(s, t, from, to, c)) {
          const local = window.start.toPlainDateTime();
          const wanted = date.add({ days: t.from.dayOffset }).toPlainDateTime(t.from.time);
          const shift = wanted.until(local).total('minutes');
          expect(shift).toBeGreaterThanOrEqual(0);
          expect(shift).toBeLessThanOrEqual(60);
        }
      }),
    );
  });
});
