import { describe, expect, it } from 'vitest';
import { channelsFor, isTooLate, pushTime, underCeiling, type Reach } from './timing';

// When a push goes out, how many a day, and by which channels (ADR-0014 §3–§5, clarifications).
// Fixed dates and zones (TEST-2), across midnight and daylight-saving changes.

const time = (text: string) => Temporal.PlainTime.from(text);
const at = (text: string) => Temporal.Instant.from(text);
const brussels = 'Europe/Brussels';
/** The default quiet hours, 21:30 to 07:30 (ADR-0014 §4). */
const night = { start: time('21:30'), end: time('07:30') };

describe('pushTime (ADR-0014 §4, clarification)', () => {
  it('sends a push outside quiet hours at once', () => {
    // 12:00 in Brussels.
    expect(pushTime(at('2026-10-08T10:00:00Z'), night, brussels)).toEqual(
      at('2026-10-08T10:00:00Z'),
    );
    // 21:29, a minute before they begin.
    expect(pushTime(at('2026-10-08T19:29:00Z'), night, brussels)).toEqual(
      at('2026-10-08T19:29:00Z'),
    );
  });

  it('holds one in quiet hours until they end, the next morning when they pass midnight', () => {
    // 21:30, as they begin, and 23:59: until 07:30 the next day.
    expect(pushTime(at('2026-10-08T19:30:00Z'), night, brussels)).toEqual(
      at('2026-10-09T05:30:00Z'),
    );
    expect(pushTime(at('2026-10-08T21:59:00Z'), night, brussels)).toEqual(
      at('2026-10-09T05:30:00Z'),
    );
    // 03:00: until 07:30 the same day.
    expect(pushTime(at('2026-10-09T01:00:00Z'), night, brussels)).toEqual(
      at('2026-10-09T05:30:00Z'),
    );
  });

  it('sends one due as they end at once: they run up to their end', () => {
    expect(pushTime(at('2026-10-09T05:30:00Z'), night, brussels)).toEqual(
      at('2026-10-09T05:30:00Z'),
    );
  });

  it('holds one in quiet hours within a day, such as an afternoon nap', () => {
    const nap = { start: time('13:00'), end: time('15:00') };
    expect(pushTime(at('2026-10-08T11:30:00Z'), nap, brussels)).toEqual(at('2026-10-08T13:00:00Z'));
    expect(pushTime(at('2026-10-08T13:00:00Z'), nap, brussels)).toEqual(at('2026-10-08T13:00:00Z'));
  });

  it('reads them in the time zone of the household it comes from', () => {
    // 20:00 UTC is 22:00 in Brussels, quiet, and 21:00 in Lisbon, not yet.
    expect(pushTime(at('2026-10-08T20:00:00Z'), night, brussels)).toEqual(
      at('2026-10-09T05:30:00Z'),
    );
    expect(pushTime(at('2026-10-08T20:00:00Z'), night, 'Europe/Lisbon')).toEqual(
      at('2026-10-08T20:00:00Z'),
    );
  });

  it('ends them at 07:30 on the clock when clocks change that night', () => {
    // Clocks go back at 03:00 on 25 October 2026: 07:30 is then 06:30 UTC, not 05:30.
    expect(pushTime(at('2026-10-24T21:00:00Z'), night, brussels)).toEqual(
      at('2026-10-25T06:30:00Z'),
    );
    // And forward at 02:00 on 29 March 2026: 07:30 is then 05:30 UTC.
    expect(pushTime(at('2026-03-28T22:00:00Z'), night, brussels)).toEqual(
      at('2026-03-29T05:30:00Z'),
    );
  });

  it('ends them as late as the clock allows when the change skips their end', () => {
    // 01:00 to 02:30 on 29 March 2026, when 02:00 becomes 03:00: they end at 03:30, 01:30 UTC.
    const short = { start: time('01:00'), end: time('02:30') };
    expect(pushTime(at('2026-03-29T00:15:00Z'), short, brussels)).toEqual(
      at('2026-03-29T01:30:00Z'),
    );
  });

  it('ends them after the push was due in the hour clocks repeat', () => {
    // 02:00 to 02:45 on 25 October 2026, when 03:00 becomes 02:00 again. At 02:15 the second
    // time, 01:15 UTC, they end at 02:45 the second time, 01:45 UTC.
    const repeated = { start: time('02:00'), end: time('02:45') };
    expect(pushTime(at('2026-10-25T01:15:00Z'), repeated, brussels)).toEqual(
      at('2026-10-25T01:45:00Z'),
    );
    // At 02:15 the first time, 00:15 UTC, at 02:45 the first time.
    expect(pushTime(at('2026-10-25T00:15:00Z'), repeated, brussels)).toEqual(
      at('2026-10-25T00:45:00Z'),
    );
  });
});

describe('underCeiling (ADR-0014 §4, clarification)', () => {
  // Four pushes on Thursday 8 October in Brussels, and one late on the 7th.
  const sent = [
    at('2026-10-07T21:50:00Z'),
    at('2026-10-08T06:00:00Z'),
    at('2026-10-08T08:00:00Z'),
    at('2026-10-08T12:00:00Z'),
    at('2026-10-08T15:00:00Z'),
  ];

  it('lets a fifth push through on a day, and no sixth', () => {
    expect(underCeiling(sent, at('2026-10-08T16:00:00Z'), brussels)).toBe(true);
    const fifth = [...sent, at('2026-10-08T16:00:00Z')];
    expect(underCeiling(fifth, at('2026-10-08T17:00:00Z'), brussels)).toBe(false);
  });

  it('counts the calendar day in the zone of the household the push comes from', () => {
    const fifth = [...sent, at('2026-10-08T16:00:00Z')];
    // 22:30 UTC is the 9th in Brussels: a new day.
    expect(underCeiling(fifth, at('2026-10-08T22:30:00Z'), brussels)).toBe(true);
    // 21:50 UTC on the 7th is still the 7th in Lisbon, so the 8th there has had five.
    expect(underCeiling(fifth, at('2026-10-08T22:30:00Z'), 'Europe/Lisbon')).toBe(false);
  });

  it('starts each day at its midnight, also when clocks change', () => {
    // 25 October 2026 begins at 22:00 UTC on the 24th in Brussels, and lasts 25 hours.
    const day = Array.from({ length: 5 }, (_, i) => at(`2026-10-24T22:0${String(i)}:00Z`));
    expect(underCeiling(day, at('2026-10-25T22:59:00Z'), brussels)).toBe(false);
    expect(underCeiling(day, at('2026-10-25T23:00:00Z'), brussels)).toBe(true);
  });
});

describe('isTooLate (ADR-0014 §4, clarification)', () => {
  it('drops a push a day after its notification', () => {
    const notified = at('2026-10-08T10:00:00Z');
    expect(isTooLate(notified, at('2026-10-09T09:59:00Z'))).toBe(false);
    expect(isTooLate(notified, at('2026-10-09T10:00:00Z'))).toBe(true);
  });
});

describe('channelsFor (ADR-0014 §3, §5)', () => {
  const adult: Reach = { choice: 'push', child: false, hasPush: true, emailFallback: true };

  it('pushes or e-mails as the member chose', () => {
    expect(channelsFor('plan.published', adult)).toEqual({ push: true, email: false });
    const both = { ...adult, choice: 'push-and-email' as const };
    expect(channelsFor('plan.published', both)).toEqual({ push: true, email: true });
    const email = { ...adult, choice: 'email' as const };
    expect(channelsFor('plan.drafted', email)).toEqual({ push: false, email: true });
    const app = { ...adult, choice: 'app' as const };
    expect(channelsFor('plan.published', app)).toEqual({ push: false, email: false });
  });

  it('e-mails a member without push instead, for a row that falls back, unless they turned it off', () => {
    const without = { ...adult, hasPush: false };
    expect(channelsFor('plan.published', without)).toEqual({ push: false, email: true });
    // A draft ready for review has no e-mail in the catalogue (§2).
    expect(channelsFor('plan.drafted', without)).toEqual({ push: false, email: false });
    expect(channelsFor('plan.published', { ...without, emailFallback: false })).toEqual({
      push: false,
      email: false,
    });
  });

  it('never e-mails a child (ADR-0014 §3, ADR-0012 §7)', () => {
    const child = { ...adult, child: true };
    expect(channelsFor('plan.published', { ...child, choice: 'push-and-email' })).toEqual({
      push: true,
      email: false,
    });
    expect(channelsFor('plan.published', { ...child, choice: 'email' })).toEqual({
      push: false,
      email: false,
    });
    expect(channelsFor('plan.published', { ...child, hasPush: false })).toEqual({
      push: false,
      email: false,
    });
  });
});
