import { describe, expect, it } from 'vitest';
import { householdDate } from '../households/date';
import { isAdultOn } from './age';

// The 18th birthday that makes a child an adult (ADR-0010 §7), on fixed dates (TEST-2).

const date = (text: string) => Temporal.PlainDate.from(text);

describe('isAdultOn (ADR-0010 §7)', () => {
  it('makes a child an adult on their 18th birthday, not the day before', () => {
    expect(isAdultOn(date('2008-10-08'), date('2026-10-07'))).toBe(false);
    expect(isAdultOn(date('2008-10-08'), date('2026-10-08'))).toBe(true);
    expect(isAdultOn(date('2008-10-08'), date('2026-10-09'))).toBe(true);
    expect(isAdultOn(date('1990-01-01'), date('2026-10-08'))).toBe(true);
  });

  it('counts a 29 February birthday from 1 March in other years (ADR-0001 §4)', () => {
    expect(isAdultOn(date('2008-02-29'), date('2026-02-28'))).toBe(false);
    expect(isAdultOn(date('2008-02-29'), date('2026-03-01'))).toBe(true);
  });

  it('keeps other birthdays on their day, also when the 18th falls in a leap year', () => {
    expect(isAdultOn(date('2010-02-28'), date('2028-02-27'))).toBe(false);
    expect(isAdultOn(date('2010-02-28'), date('2028-02-28'))).toBe(true);
    expect(isAdultOn(date('2010-03-01'), date('2028-02-29'))).toBe(false);
    expect(isAdultOn(date('2010-03-01'), date('2028-03-01'))).toBe(true);
  });

  it('is no adult on the day they are born, or before', () => {
    expect(isAdultOn(date('2026-10-08'), date('2026-10-08'))).toBe(false);
    expect(isAdultOn(date('2026-10-09'), date('2026-10-08'))).toBe(false);
    expect(isAdultOn(date('2050-01-01'), date('2026-10-08'))).toBe(false);
  });

  it('goes by the household’s date, in its time zone', () => {
    // 22:30 UTC on 8 October 2026 is 00:30 on the 9th in Brussels, and still 22:30 on the 8th on
    // the Azores.
    const now = Temporal.Instant.from('2026-10-08T22:30:00Z');
    const born = date('2008-10-09');
    expect(isAdultOn(born, householdDate(now, 'Europe/Brussels'))).toBe(true);
    expect(isAdultOn(born, householdDate(now, 'Atlantic/Azores'))).toBe(false);
  });
});
