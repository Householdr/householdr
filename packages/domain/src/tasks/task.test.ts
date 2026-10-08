import { describe, expect, it } from 'vitest';
import { isTaskDuration, startRange } from './task';

// What a new task may be (ADR-0001 §5, ADR-0004 §3), from examples (TEST-1).

const date = (iso: string) => Temporal.PlainDate.from(iso);

describe('isTaskDuration (ADR-0001 §5)', () => {
  it('takes whole minutes, from a minute to a day', () => {
    for (const minutes of [1, 5, 30, 90, 1440]) expect(isTaskDuration(minutes)).toBe(true);
    for (const minutes of [0, -5, 1441, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isTaskDuration(minutes)).toBe(false);
    }
  });
});

describe('startRange (ADR-0004 §3)', () => {
  it('runs from today to a year from today', () => {
    const { earliest, latest } = startRange(date('2026-10-08'));
    expect([earliest.toString(), latest.toString()]).toEqual(['2026-10-08', '2027-10-08']);
  });

  it('ends on the last day of February a year after a leap day', () => {
    expect(startRange(date('2028-02-29')).latest.toString()).toBe('2029-02-28');
  });
});
