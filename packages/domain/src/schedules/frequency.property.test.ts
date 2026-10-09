import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultTiming, frequencies, frequencyOf, frequencyRule } from './frequency';
import { spacing } from './rule';

// Invariants of the simple frequencies (ADR-0004 §3, §4; TEST-1).

const frequency = fc.constantFrom(...frequencies);
const day = fc
  .integer({ min: 0, max: 4 * 366 })
  .map((n) => Temporal.PlainDate.from('2026-01-01').add({ days: n }));

describe('simple frequency invariants (ADR-0004 §3, §4)', () => {
  it('read back as the frequency they were made from, whatever the start', () => {
    fc.assert(
      fc.property(frequency, day, (f, start) => {
        const schedule = { rules: [frequencyRule(f, start)], extraDates: [], exceptionDates: [] };
        expect(frequencyOf(schedule)).toBe(f);
      }),
    );
  });

  it('float exactly when they recur a month or more apart, and are flexible otherwise', () => {
    fc.assert(
      fc.property(frequency, day, (f, start) => {
        const apart = Temporal.Duration.compare(
          spacing(frequencyRule(f, start)),
          { months: 1 },
          {
            relativeTo: start,
          },
        );
        expect(defaultTiming(f).kind).toBe(apart >= 0 ? 'floating' : 'flexible');
      }),
    );
  });
});
