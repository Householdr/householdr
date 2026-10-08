import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isAdultOn } from './age';

// Invariants of the 18th birthday over generated birth dates and days, leap days and the days
// around each birthday included (TEST-1, ADR-0010 §7).

const origin = Temporal.PlainDate.from('1990-01-01');
const day = fc.integer({ min: 0, max: 70 * 366 }).map((n) => origin.add({ days: n }));
// A 29 February in a leap year between 1992 and 2056, which generated days rarely hit.
const leapDay = fc
  .integer({ min: 0, max: 16 })
  .map((n) => Temporal.PlainDate.from({ year: 1992 + 4 * n, month: 2, day: 29 }));
const birthDate = fc.oneof(day, leapDay);

/**
 * The 18th birthday, worked out apart from Temporal's arithmetic: the same day 18 years on, or
 * 1 March for a 29 February birthday in a year without one (ADR-0001 §4, clarification).
 */
function eighteenthBirthday(born: Temporal.PlainDate) {
  const year = born.year + 18;
  const leap = Temporal.PlainDate.from({ year, month: 1, day: 1 }).inLeapYear;
  if (born.month === 2 && born.day === 29 && !leap) {
    return Temporal.PlainDate.from({ year, month: 3, day: 1 });
  }
  return Temporal.PlainDate.from({ year, month: born.month, day: born.day });
}

// A day near the 18th birthday of `born`, where the answer changes.
const nearBirthday = birthDate.chain((born) =>
  fc.tuple(
    fc.constant(born),
    fc.integer({ min: -3, max: 3 }).map((n) => eighteenthBirthday(born).add({ days: n })),
  ),
);

describe('isAdultOn invariants (ADR-0010 §7)', () => {
  it('is true exactly from the 18th birthday on', () => {
    fc.assert(
      fc.property(fc.oneof(fc.tuple(birthDate, day), nearBirthday), ([born, on]) => {
        const adult = Temporal.PlainDate.compare(on, eighteenthBirthday(born)) >= 0;
        expect(isAdultOn(born, on)).toBe(adult);
      }),
    );
  });

  it('never turns an adult back into a child', () => {
    fc.assert(
      fc.property(birthDate, day, fc.integer({ min: 1, max: 3000 }), (born, on, later) => {
        if (isAdultOn(born, on)) expect(isAdultOn(born, on.add({ days: later }))).toBe(true);
      }),
    );
  });

  it('makes no one an adult before they are born', () => {
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 30 * 366 }), (born, before) => {
        expect(isAdultOn(born, born.subtract({ days: before }))).toBe(false);
      }),
    );
  });
});
