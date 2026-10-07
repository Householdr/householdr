import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { isEligible, type Candidate, type Constraint } from './eligibility';

// Invariants of eligibility over generated members, tasks and windows (TEST-1).

const origin = Temporal.PlainDate.from('2026-10-01');
const calendar: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const day = fc.integer({ min: 0, max: 30 }).map((n) => origin.add({ days: n }));
const absence = fc
  .tuple(day, fc.integer({ min: 0, max: 5 }))
  .map(([from, length]) => ({ from, to: from.add({ days: length }) }));
const candidate: fc.Arbitrary<Candidate> = fc.record(
  {
    id: fc.constant('m'),
    fairFraction: fc.constantFrom(0, 0.25, 1),
    availability: fc.record({
      absences: fc.array(absence, { maxLength: 2 }),
      unavailable: fc.constant([]),
    }),
    birthDate: fc.integer({ min: 0, max: 20 * 366 }).map((n) => origin.subtract({ days: n })),
  },
  { requiredKeys: ['id', 'fairFraction', 'availability'] },
);
const minimumAge = fc.option(fc.integer({ min: 0, max: 18 }), { nil: undefined });
const window = fc
  .tuple(day, fc.integer({ min: 0, max: 23 }), fc.integer({ min: 1, max: 72 }))
  .map(([d, hour, hours]) => {
    const begin = d.toZonedDateTime({ timeZone: calendar.timeZone }).add({ hours: hour });
    return { start: begin, end: begin.add({ hours }) };
  });
const eligible = (
  member: Candidate,
  age: number | undefined,
  constraint: Constraint | undefined,
  w: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime },
) =>
  isEligible(
    member,
    {
      ...(age === undefined ? {} : { minimumAge: age }),
      constraints: new Map(constraint ? [['m', constraint]] : []),
    },
    w,
    w.start.toPlainDate(),
    calendar,
  );

describe('eligibility invariants (ADR-0001 §7)', () => {
  it('never gives an excluded task, or anything to a member without a fair portion', () => {
    fc.assert(
      fc.property(candidate, minimumAge, window, (m, age, w) => {
        expect(eligible(m, age, 'excluded', w)).toBe(false);
        for (const c of [undefined, 'allowed', 'bound'] as const) {
          if (m.fairFraction === 0) expect(eligible(m, age, c, w)).toBe(false);
        }
      }),
    );
  });

  it('only widens when a head allows or binds', () => {
    fc.assert(
      fc.property(candidate, minimumAge, window, (m, age, w) => {
        if (eligible(m, age, undefined, w)) {
          expect(eligible(m, age, 'allowed', w)).toBe(true);
          expect(eligible(m, age, 'bound', w)).toBe(true);
        }
        expect(eligible(m, age, 'allowed', w)).toBe(eligible(m, undefined, undefined, w));
      }),
    );
  });

  it('never grows with another absence', () => {
    fc.assert(
      fc.property(candidate, minimumAge, window, absence, (m, age, w, extra) => {
        const away = {
          ...m,
          availability: { ...m.availability, absences: [...m.availability.absences, extra] },
        };
        if (eligible(away, age, undefined, w)) expect(eligible(m, age, undefined, w)).toBe(true);
      }),
    );
  });
});
