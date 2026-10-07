import { describe, expect, it } from 'vitest';
import { expiredFlags } from './expiry';
import type { Flag } from './flag';

const info = { description: 'd', owner: 'o' };
const registry: Record<string, Flag> = {
  'not-yet': { ...info, kind: 'release', expires: '2026-10-08' },
  today: { ...info, kind: 'release', expires: '2026-10-07' },
  'a-day': { ...info, kind: 'release', expires: '2026-10-06' },
  'across-a-year': { ...info, kind: 'release', expires: '2025-12-31' },
  permanent: { ...info, kind: 'kill-switch' },
};

describe('expiredFlags (ADR-0015 §4)', () => {
  it('lists release flags past their date, longest overdue first', () => {
    expect(expiredFlags(registry, Temporal.PlainDate.from('2026-10-07'))).toEqual([
      { key: 'across-a-year', expires: '2025-12-31', daysPast: 280 },
      { key: 'a-day', expires: '2026-10-06', daysPast: 1 },
    ]);
  });

  it('never lists kill switches, which are permanent', () => {
    expect(
      expiredFlags(registry, Temporal.PlainDate.from('2099-01-01')).map((f) => f.key),
    ).not.toContain('permanent');
  });
});
