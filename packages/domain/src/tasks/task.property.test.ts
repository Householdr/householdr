import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { changedStartRange, isStartDay, isTaskDuration, startRange, taskDuration } from './task';

// Invariants of what a new or changed task may be (ADR-0001 §5, ADR-0004 §3; TEST-1).

describe('task duration invariants (ADR-0001 §5)', () => {
  it('accepts exactly the whole numbers within the limits', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000 }), (minutes) => {
        const within = minutes >= taskDuration.min && minutes <= taskDuration.max;
        expect(isTaskDuration(minutes)).toBe(within);
      }),
    );
  });

  it('refuses any part of a minute', () => {
    fc.assert(fc.property(fc.double({ noInteger: true }), (minutes) => !isTaskDuration(minutes)));
  });
});

const day = fc
  .integer({ min: 0, max: 4 * 366 })
  .map((n) => Temporal.PlainDate.from('2026-01-01').add({ days: n }));

describe('start range invariants (ADR-0004 §3)', () => {
  it('starts today and lasts a year, so it holds every anchor of a yearly task', () => {
    fc.assert(
      fc.property(day, (today) => {
        const { earliest, latest } = startRange(today);
        expect(earliest.equals(today)).toBe(true);
        expect([365, 366]).toContain(today.until(latest).days);
      }),
    );
  });
});

describe('start day invariants (ADR-0004 §3)', () => {
  it('always keeps the day a task starts on, and moves none to another day in the past', () => {
    fc.assert(
      fc.property(day, day, day, (start, today, kept) => {
        expect(isStartDay(kept, today, kept)).toBe(true);
        if (Temporal.PlainDate.compare(start, today) < 0 && !start.equals(kept)) {
          expect(isStartDay(start, today, kept)).toBe(false);
        }
      }),
    );
  });

  it('offers every day a changed task can start on, kept or new', () => {
    fc.assert(
      fc.property(day, day, day, (start, today, kept) => {
        const { earliest, latest } = changedStartRange(today, kept);
        if (!isStartDay(start, today, kept)) return;
        expect(Temporal.PlainDate.compare(start, earliest)).toBeGreaterThanOrEqual(0);
        expect(Temporal.PlainDate.compare(start, latest)).toBeLessThanOrEqual(0);
      }),
    );
  });
});
