import { describe, expect, it } from 'vitest';
import { householdDate } from './date';

// The household's date: the day in its time zone, turning at local midnight (TEST-2).

const at = (instant: string, timeZone: string) =>
  householdDate(Temporal.Instant.from(instant), timeZone).toString();

describe('householdDate (ADR-0008 §11)', () => {
  it('is the day it is in the household’s time zone, not the server’s or UTC', () => {
    expect(at('2026-10-08T22:30:00Z', 'Europe/Brussels')).toBe('2026-10-09');
    expect(at('2026-10-08T22:30:00Z', 'Atlantic/Azores')).toBe('2026-10-08');
    expect(at('2026-10-09T01:30:00Z', 'America/Cayenne')).toBe('2026-10-08');
  });

  it('turns at local midnight, also around the days the clocks change', () => {
    // Brussels moves to summer time at 01:00 UTC on 29 March 2026, and back at 01:00 UTC on 25
    // October 2026.
    const brussels = 'Europe/Brussels';
    expect(at('2026-03-28T22:59:59Z', brussels)).toBe('2026-03-28');
    expect(at('2026-03-28T23:00:00Z', brussels)).toBe('2026-03-29');
    expect(at('2026-03-29T21:59:59Z', brussels)).toBe('2026-03-29');
    expect(at('2026-03-29T22:00:00Z', brussels)).toBe('2026-03-30');
    expect(at('2026-10-24T21:59:59Z', brussels)).toBe('2026-10-24');
    expect(at('2026-10-24T22:00:00Z', brussels)).toBe('2026-10-25');
    expect(at('2026-10-25T22:59:59Z', brussels)).toBe('2026-10-25');
    expect(at('2026-10-25T23:00:00Z', brussels)).toBe('2026-10-26');
  });
});
