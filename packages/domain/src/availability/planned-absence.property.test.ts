import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { isAvailableDuring } from './availability';
import { plannableDays, unplannableEnds } from './planned-absence';

// Invariants of planning an absence over generated dates, time zones and lengths (TEST-1), across
// leap days and clock changes (TEST-2).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = fc.integer({ min: 0, max: 3 * 366 }).map((n) => origin.add({ days: n }));
const offset = fc.integer({ min: -400, max: 800 });
const calendar = fc.record<HouseholdCalendar>({
  timeZone: fc.constantFrom('Europe/Brussels', 'America/Santiago', 'Australia/Sydney', 'UTC'),
  weekStartDay: fc.constantFrom(1, 2, 3, 4, 5, 6, 7),
});
const before = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) < 0;

describe('planned absence invariants (ADR-0005 §2)', () => {
  it('can be planned exactly when today ≤ first ≤ last ≤ a year from today', () => {
    fc.assert(
      fc.property(day, offset, offset, (today, first, last) => {
        const from = today.add({ days: first });
        const to = today.add({ days: last });
        const limit = today.add({ years: 1 });
        const plannable = !before(from, today) && !before(to, from) && !before(limit, to);
        expect(unplannableEnds({ from, to }, today).length === 0).toBe(plannable);
      }),
    );
  });

  it('can always be planned for the whole of the plannable days, or any one of them', () => {
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 366 }), (today, n) => {
        const days = plannableDays(today);
        expect(unplannableEnds(days, today)).toEqual([]);
        const one = today.add({ days: n });
        const plannable = !before(days.to, one);
        expect(unplannableEnds({ from: one, to: one }, today).length === 0).toBe(plannable);
      }),
    );
  });

  it('makes the member unavailable on every one of its days, both ends included', () => {
    fc.assert(
      fc.property(
        calendar,
        day,
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (c, from, length, n) => {
          const to = from.add({ days: length });
          const away = { absences: [{ from, to }], unavailable: [] };
          const startOf = (d: Temporal.PlainDate) => d.toZonedDateTime({ timeZone: c.timeZone });
          const inside = from.add({ days: Math.min(n, length) });
          const wholeDay = { start: startOf(inside), end: startOf(inside.add({ days: 1 })) };
          expect(isAvailableDuring(away, wholeDay, c)).toBe(false);
          // The hours just before its first day and just after its last are at home.
          const first = startOf(from);
          const afterLast = startOf(to.add({ days: 1 }));
          const hourBefore = { start: first.subtract({ hours: 1 }), end: first };
          const hourAfter = { start: afterLast, end: afterLast.add({ hours: 1 }) };
          expect(isAvailableDuring(away, hourBefore, c)).toBe(true);
          expect(isAvailableDuring(away, hourAfter, c)).toBe(true);
        },
      ),
    );
  });
});
