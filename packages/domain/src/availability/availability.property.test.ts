import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import {
  availabilityInWeek,
  availableWindows,
  type Absence,
  type Availability,
} from './availability';

// Invariants of availability over generated patterns, absences, zones and week starts, with and
// without a change of start day (TEST-1, ADR-0006 §1).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = fc.integer({ min: 0, max: 365 }).map((n) => origin.add({ days: n }));
type Weekday = HouseholdCalendar['weekStartDay'];
const weekday = fc.constantFrom<Weekday>(1, 2, 3, 4, 5, 6, 7);
const calendar: fc.Arbitrary<HouseholdCalendar> = fc
  .tuple(
    fc.constantFrom('Europe/Brussels', 'America/Santiago', 'Australia/Sydney', 'UTC'),
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
  .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.constantFrom(0, 30) })
  .map((t) => Temporal.PlainTime.from(t));
const absence: fc.Arbitrary<Absence> = fc
  .tuple(day, fc.integer({ min: 0, max: 10 }))
  .map(([from, length]) => ({ from, to: from.add({ days: length }) }));
const pattern = fc.record({
  rrule: fc.constantFrom('FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=FR', 'FREQ=WEEKLY;INTERVAL=2'),
  start: day,
  from: plainTime,
  to: plainTime,
  days: fc.integer({ min: 1, max: 7 }),
});
const availability = (zone: string): fc.Arbitrary<Availability> =>
  fc.record({
    pattern: fc.option(
      pattern.map((p) => ({
        schedule: {
          rules: [{ rrule: p.rrule, start: p.start }],
          extraDates: [],
          exceptionDates: [],
        },
        from: { dayOffset: 0, time: p.from },
        to: { dayOffset: p.days, time: p.to },
      })),
      { nil: undefined },
    ),
    absences: fc.array(absence, { maxLength: 3 }),
    unavailable: fc.array(
      fc.tuple(day, fc.integer({ min: 1, max: 72 })).map(([d, hours]) => {
        const start = d.toZonedDateTime({ timeZone: zone });
        return { start, end: start.add({ hours }) };
      }),
      { maxLength: 3 },
    ),
  });
const withCalendar = calendar.chain((c) => fc.tuple(fc.constant(c), availability(c.timeZone), day));

describe('availability invariants (ADR-0005 §2)', () => {
  it('is a fraction of the week, and the whole week without any layer', () => {
    fc.assert(
      fc.property(withCalendar, ([c, a, d]) => {
        const fraction = availabilityInWeek(a, d, c);
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThanOrEqual(1);
        expect(availabilityInWeek({ absences: [], unavailable: [] }, d, c)).toBe(1);
      }),
    );
  });

  it('never grows when an absence is added', () => {
    fc.assert(
      fc.property(withCalendar, absence, ([c, a, d], extra) => {
        const more = { ...a, absences: [...a.absences, extra] };
        expect(availabilityInWeek(more, d, c)).toBeLessThanOrEqual(availabilityInWeek(a, d, c));
      }),
    );
  });

  it('returns ordered, separate windows inside the range', () => {
    fc.assert(
      fc.property(withCalendar, fc.integer({ min: 1, max: 240 }), ([c, a, d], hours) => {
        const start = d.toZonedDateTime({ timeZone: c.timeZone });
        const range = { start, end: start.add({ hours }) };
        const windows = availableWindows(a, range, c);
        windows.forEach((w, i) => {
          expect(Temporal.ZonedDateTime.compare(w.start, w.end)).toBe(-1);
          expect(Temporal.ZonedDateTime.compare(w.start, range.start)).toBeGreaterThanOrEqual(0);
          expect(Temporal.ZonedDateTime.compare(w.end, range.end)).toBeLessThanOrEqual(0);
          const previous = windows[i - 1];
          if (previous) expect(Temporal.ZonedDateTime.compare(previous.end, w.start)).toBe(-1);
        });
      }),
    );
  });
});
