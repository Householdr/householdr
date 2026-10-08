import { describe, expect, it } from 'vitest';
import { systemClock } from './system-clock';

describe('systemClock', () => {
  it('tells the current time', () => {
    const before = Temporal.Now.instant();
    const now = systemClock.now();
    expect(Temporal.Instant.compare(before, now)).toBeLessThanOrEqual(0);
    expect(Temporal.Instant.compare(now, Temporal.Now.instant())).toBeLessThanOrEqual(0);
  });
});
