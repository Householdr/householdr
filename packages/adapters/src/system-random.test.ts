import { describe, expect, it } from 'vitest';
import { systemRandom } from './system-random';

describe('systemRandom', () => {
  it('draws numbers from 0 up to 1, on both sides of ½', () => {
    const draws = Array.from({ length: 200 }, () => systemRandom.next());
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
    // Each side has a chance of 2⁻²⁰⁰ of never coming up.
    expect(draws.some((draw) => draw < 0.5)).toBe(true);
    expect(draws.some((draw) => draw >= 0.5)).toBe(true);
  });
});
