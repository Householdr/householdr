import { describe, expect, it } from 'vitest';
import { plannableDays, unplannableEnds } from './planned-absence';

// Which planned absences can be planned (ADR-0005 §2), from fixed dates (TEST-2).

const date = (iso: string) => Temporal.PlainDate.from(iso);
const absence = (from: string, to: string) => ({ from: date(from), to: date(to) });
const today = date('2026-10-08');
const shown = (days: { from: Temporal.PlainDate; to: Temporal.PlainDate }) => [
  days.from.toString(),
  days.to.toString(),
];

describe('plannableDays', () => {
  it('runs from today to a year ahead', () => {
    expect(shown(plannableDays(today))).toEqual(['2026-10-08', '2027-10-08']);
  });

  it('ends on 28 February a year after a 29 February', () => {
    expect(shown(plannableDays(date('2028-02-29')))).toEqual(['2028-02-29', '2029-02-28']);
  });
});

describe('unplannableEnds', () => {
  it('accepts whole days from today to a year ahead, both ends included', () => {
    expect(unplannableEnds(absence('2026-10-08', '2026-10-08'), today)).toEqual([]);
    expect(unplannableEnds(absence('2026-10-12', '2026-10-16'), today)).toEqual([]);
    expect(unplannableEnds(absence('2026-12-24', '2027-01-03'), today)).toEqual([]);
    expect(unplannableEnds(absence('2026-10-08', '2027-10-08'), today)).toEqual([]);
    expect(unplannableEnds(absence('2027-10-08', '2027-10-08'), today)).toEqual([]);
  });

  it('refuses a last day before the first', () => {
    expect(unplannableEnds(absence('2026-10-16', '2026-10-12'), today)).toEqual(['to']);
    expect(unplannableEnds(absence('2026-10-13', '2026-10-12'), today)).toEqual(['to']);
  });

  it('refuses a first day in the past, which is no longer planning ahead', () => {
    expect(unplannableEnds(absence('2026-10-07', '2026-10-09'), today)).toEqual(['from']);
    expect(unplannableEnds(absence('2026-10-01', '2026-10-07'), today)).toEqual(['from', 'to']);
  });

  it('refuses an end that isn’t a day, and still checks the other', () => {
    const missing = { from: undefined, to: undefined };
    expect(unplannableEnds(missing, today)).toEqual(['from', 'to']);
    expect(unplannableEnds({ ...missing, to: date('2026-10-12') }, today)).toEqual(['from']);
    expect(unplannableEnds({ ...missing, from: date('2026-10-07') }, today)).toEqual([
      'from',
      'to',
    ]);
  });

  it('refuses days over a year ahead, such as a mistyped year', () => {
    expect(unplannableEnds(absence('2026-10-12', '2027-10-09'), today)).toEqual(['to']);
    expect(unplannableEnds(absence('2027-10-09', '2027-10-10'), today)).toEqual(['from', 'to']);
    expect(unplannableEnds(absence('2026-10-12', '2062-10-16'), today)).toEqual(['to']);
  });
});
