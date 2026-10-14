import { describe, expect, it } from 'vitest';
import { areQuietHours, channelsWith, defaultPreferences } from './preferences';

// An account's notification preferences (ADR-0014 §3, §4, clarifications).

const time = (text: string) => Temporal.PlainTime.from(text);

describe('defaultPreferences (ADR-0014 §2–§5)', () => {
  it('pushes every category, keeps quiet from 21:30 to 07:30, and falls back to e-mail', () => {
    expect(defaultPreferences.channels).toEqual({
      'plan.published': 'push',
      'plan.drafted': 'push',
    });
    expect(defaultPreferences.quietHours.start.toString()).toBe('21:30:00');
    expect(defaultPreferences.quietHours.end.toString()).toBe('07:30:00');
    expect(defaultPreferences.emailFallback).toBe(true);
  });
});

describe('channelsWith (ADR-0014 §3, clarification)', () => {
  it('keeps what the account chose', () => {
    expect(channelsWith({ 'plan.published': 'email', 'plan.drafted': 'app' })).toEqual({
      'plan.published': 'email',
      'plan.drafted': 'app',
    });
  });

  it('gives a category the account hasn’t chosen for its catalogue default', () => {
    expect(channelsWith({ 'plan.published': 'push-and-email' })).toEqual({
      'plan.published': 'push-and-email',
      'plan.drafted': 'push',
    });
    expect(channelsWith({})).toEqual(defaultPreferences.channels);
  });
});

describe('areQuietHours (ADR-0014 §3, clarification)', () => {
  it('takes any start and end that differ, across midnight too', () => {
    expect(areQuietHours({ start: time('21:30'), end: time('07:30') })).toBe(true);
    expect(areQuietHours({ start: time('13:00'), end: time('14:15') })).toBe(true);
    expect(areQuietHours({ start: time('23:59'), end: time('00:00') })).toBe(true);
  });

  it('refuses equal times, which could mean none or all day', () => {
    expect(areQuietHours({ start: time('07:30'), end: time('07:30') })).toBe(false);
  });
});
