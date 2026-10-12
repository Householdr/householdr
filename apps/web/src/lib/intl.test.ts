import { describe, expect, it } from 'vitest';
import { dayText, formattingLocale, fullDay, timeZoneName } from './intl';

// 8 October 2026, 10:00 in Brussels.
const at = Date.UTC(2026, 9, 8, 8);

describe('the locale values are written in (ADR-0008 §6)', () => {
  it('is the page’s language with the country of the account’s culture', () => {
    expect(formattingLocale('en', 'nl-BE')).toBe('en-BE');
    expect(formattingLocale('nl', 'nl-BE')).toBe('nl-BE');
    expect(formattingLocale('nl', 'en-NL')).toBe('nl-NL');
  });

  it('keeps the country of a culture whose language isn’t offered (ADR-0016 §1)', () => {
    expect(formattingLocale('en', 'de-BE')).toBe('en-BE');
  });

  it('is the page’s language alone for someone not signed in', () => {
    expect(formattingLocale('en', null)).toBe('en');
    expect(formattingLocale('nl', null)).toBe('nl');
  });

  it('writes a day with the culture’s conventions, in the page’s language', () => {
    expect(dayText('2026-10-08', formattingLocale('en', 'nl-BE'))).toBe('8 October 2026');
    expect(dayText('2026-10-08', formattingLocale('en', 'en-US'))).toBe('October 8, 2026');
    expect(dayText('2026-10-08', formattingLocale('nl', 'nl-BE'))).toBe('8 oktober 2026');
  });

  it('writes a day in full, as a vague day’s tooltip does (ADR-0008 §6, clarification)', () => {
    expect(fullDay('2026-10-08', 'en-BE')).toBe('Thursday, 8 October 2026');
    expect(fullDay('2026-10-08', 'nl-BE')).toBe('donderdag 8 oktober 2026');
  });
});

describe('the name of a time zone', () => {
  it('is its city and its name in the locale', () => {
    expect(timeZoneName('Europe/Brussels', 'en-BE', at)).toBe('Brussels (Central European Time)');
    expect(timeZoneName('Atlantic/Canary', 'en', at)).toBe('Canary (Western European Time)');
    expect(timeZoneName('Indian/Reunion', 'en', at)).toBe('Reunion (Réunion Time)');
  });

  it('writes the city with spaces for underscores, as the IANA name has it in every language', () => {
    expect(timeZoneName('America/Argentina/Buenos_Aires', 'en', at)).toBe(
      'Buenos Aires (Argentina Standard Time)',
    );
    expect(timeZoneName('America/Argentina/Buenos_Aires', 'nl', at)).toBe(
      'Buenos Aires (Argentijnse standaardtijd)',
    );
    expect(timeZoneName('Europe/Brussels', 'nl-BE', at)).toBe('Brussels (Midden-Europese tijd)');
  });

  it('has the offset where Intl has no name for the zone', () => {
    expect(timeZoneName('Etc/GMT-3', 'en', at)).toBe('GMT-3 (GMT+03:00)');
    expect(timeZoneName('Etc/GMT-3', 'nl', at)).toBe('GMT-3 (GMT+03:00)');
  });

  it('is the zone’s name at the time, as its rules have changed over the years', () => {
    expect(timeZoneName('Europe/Kyiv', 'en', at)).toBe('Kyiv (Eastern European Time)');
    expect(timeZoneName('Europe/Kyiv', 'en', Date.UTC(1980, 0, 15))).toBe(
      'Kyiv (Moscow Standard Time)',
    );
  });
});
