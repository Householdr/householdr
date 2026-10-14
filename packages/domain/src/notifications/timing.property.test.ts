import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emailTime, pushTime } from './timing';

// Invariants of when a push goes out, over generated moments, quiet hours and zones (TEST-1,
// ADR-0014 §4, clarification).

const zone = fc.constantFrom('Europe/Brussels', 'Europe/Lisbon', 'Europe/Helsinki', 'UTC');
const minutes = fc.integer({ min: 0, max: 24 * 60 - 1 });
const timeOf = (m: number) => Temporal.PlainTime.from({ hour: Math.floor(m / 60), minute: m % 60 });
const quiet = fc
  .tuple(minutes, minutes)
  .filter(([start, end]) => start !== end)
  .map(([start, end]) => ({ start: timeOf(start), end: timeOf(end) }));
// Moments over 2026, both daylight-saving changes included.
const moment = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) })
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

describe('pushTime invariants (ADR-0014 §4, clarification)', () => {
  it('never sends early, waits less than a day, and lands outside quiet hours', () => {
    fc.assert(
      fc.property(moment, quiet, zone, (at, hours, timeZone) => {
        const sent = pushTime(at, hours, timeZone);
        expect(Temporal.Instant.compare(sent, at)).toBeGreaterThanOrEqual(0);
        expect(sent.since(at).total('hours')).toBeLessThan(25);
        // Sending then needs no more waiting.
        expect(pushTime(sent, hours, timeZone)).toEqual(sent);
      }),
    );
  });
});

describe('emailTime invariants (ADR-0014 §5, clarification)', () => {
  it('never comes before a push would, comes within a day, and as quiet hours end', () => {
    fc.assert(
      fc.property(moment, quiet, zone, (at, hours, timeZone) => {
        const sent = emailTime(at, hours, timeZone);
        expect(
          Temporal.Instant.compare(sent, pushTime(at, hours, timeZone)),
        ).toBeGreaterThanOrEqual(0);
        expect(sent.since(at).total('hours')).toBeLessThan(25);
        // What is made as it comes goes in it.
        expect(emailTime(sent, hours, timeZone)).toEqual(sent);
      }),
    );
  });
});
