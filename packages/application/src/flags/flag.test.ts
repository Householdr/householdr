import { describe, expect, it } from 'vitest';
import { safeDefault } from './flag';

describe('safeDefault (ADR-0015 §4)', () => {
  it('keeps unfinished work hidden', () => {
    expect(
      safeDefault({ kind: 'release', description: 'd', owner: 'o', expires: '2026-12-01' }),
    ).toBe(false);
  });

  it('leaves working features on', () => {
    expect(safeDefault({ kind: 'kill-switch', description: 'd', owner: 'o' })).toBe(true);
  });
});
