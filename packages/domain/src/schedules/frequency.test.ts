import { describe, expect, it } from 'vitest';
import {
  defaultTiming,
  frequencies,
  frequencyOf,
  frequencyRule,
  type Frequency,
} from './frequency';
import type { Schedule } from './schedule';

// Simple frequencies as presets over the schedule model (ADR-0004 §3, §4), from examples (TEST-1).

const date = (iso: string) => Temporal.PlainDate.from(iso);
const simple = (frequency: Frequency): Schedule => ({
  rules: [frequencyRule(frequency, date('2026-10-08'))],
  extraDates: [],
  exceptionDates: [],
});

describe('frequencies (ADR-0004 §3)', () => {
  it('are the six presets, most often first', () => {
    expect(frequencies).toEqual([
      'daily',
      'weekly',
      'biweekly',
      'monthly',
      'tri-monthly',
      'yearly',
    ]);
  });
});

describe('defaultTiming (ADR-0004 §4)', () => {
  it.each([
    ['daily', 'flexible'],
    ['weekly', 'flexible'],
    ['biweekly', 'flexible'],
    ['monthly', 'floating'],
    ['tri-monthly', 'floating'],
    ['yearly', 'floating'],
  ] as const)('makes a %s task %s', (frequency, kind) => {
    expect(defaultTiming(frequency)).toEqual({ kind });
  });
});

describe('frequencyOf (ADR-0004 §3)', () => {
  it.each(frequencies)('reads a %s schedule back', (frequency) => {
    expect(frequencyOf(simple(frequency))).toBe(frequency);
  });

  it('is none for a schedule beyond a simple frequency', () => {
    const weekly = simple('weekly');
    const [rule] = weekly.rules;
    if (!rule) throw new Error('No rule');
    const summer = {
      from: Temporal.PlainMonthDay.from('07-01'),
      to: Temporal.PlainMonthDay.from('08-31'),
    };
    for (const schedule of [
      { ...weekly, rules: [] },
      { ...weekly, rules: [rule, frequencyRule('monthly', date('2026-10-08'))] },
      { ...weekly, rules: [{ ...rule, season: summer }] },
      { ...weekly, rules: [{ ...rule, rrule: 'FREQ=WEEKLY;BYDAY=TU' }] },
      { ...weekly, extraDates: [date('2026-12-24')] },
      { ...weekly, exceptionDates: [date('2026-12-23')] },
    ]) {
      expect(frequencyOf(schedule)).toBeUndefined();
    }
  });
});
