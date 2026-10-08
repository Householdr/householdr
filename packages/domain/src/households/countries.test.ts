import { describe, expect, it } from 'vitest';
import { countries, countryOfTimeZone, isCountry, timeZonesOf } from './countries';

describe('the countries a household can be in (ADR-0016 §1)', () => {
  it('are the 27 of the EU and the 3 more of the EEA', () => {
    expect(countries).toHaveLength(30);
    for (const code of ['BE', 'NL', 'FR', 'DE', 'IS', 'LI', 'NO'])
      expect(isCountry(code)).toBe(true);
    for (const code of ['GB', 'CH', 'US', 'be', '', 'toString'])
      expect(isCountry(code)).toBe(false);
  });

  it('each have time zones the runtime knows, none shared by two', () => {
    const known = new Set(Intl.supportedValuesOf('timeZone'));
    const all = countries.flatMap(timeZonesOf);
    expect(all.filter((zone) => !known.has(zone))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('can be told from a browser’s time zone, without its IP address (ADR-0007 §2)', () => {
    expect(countryOfTimeZone('Europe/Brussels')).toBe('BE');
    expect(countryOfTimeZone('Atlantic/Canary')).toBe('ES');
    expect(countryOfTimeZone('Indian/Reunion')).toBe('FR');
    expect(countryOfTimeZone('Europe/London')).toBeUndefined();
    expect(countryOfTimeZone('Europe/Zurich')).toBeUndefined();
  });

  it('list their mainland’s time zone first', () => {
    expect(timeZonesOf('FR')[0]).toBe('Europe/Paris');
    expect(timeZonesOf('PT')[0]).toBe('Europe/Lisbon');
  });
});
