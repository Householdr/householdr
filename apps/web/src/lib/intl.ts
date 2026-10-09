// Names and values the browser's own Intl writes, so none is written by hand (ADR-0008 §6, UI-22).
// Each takes the locale that `formattingLocale` gives, which every page has from the root layout.

import { m } from '#lib/paraglide/messages.js';

/**
 * The locale values are written in (ADR-0008 §6): the page's language with the country of the
 * account's culture, such as `en-BE` for an English page and an `nl-BE` account, or the page's
 * language alone for someone not signed in. The text is in the page's language, so a date or a
 * name inside a sentence stays in that language instead of switching to the culture's, yet it
 * follows the culture's conventions: the order of day and month, the clock, the separators. A
 * culture whose language isn't offered reads English with its own country's dates (ADR-0016 §1).
 */
export function formattingLocale(pageLanguage: string, culture: string | null) {
  const region = culture === null ? undefined : new Intl.Locale(culture).region;
  return region === undefined ? pageLanguage : new Intl.Locale(pageLanguage, { region }).toString();
}

/** The country `code` (ISO 3166-1 alpha-2) in `locale`, such as “Belgium”. */
export function countryName(code: string, locale: string) {
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
}

/** The language `code` in its own name, such as “Nederlands” (ADR-0016 §2). */
export function languageName(code: string) {
  const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  // Some languages write their own name in lower case, such as “français”; a list starts each
  // with a capital.
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

/** The day of the week `day`, 1 for Monday to 7 for Sunday, in `locale`. */
export function weekdayName(day: number, locale: string) {
  // 5 October 2026 is a Monday.
  const date = Date.UTC(2026, 9, 4 + day);
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date);
}

/** The day of `at` (epoch milliseconds) in `timeZone`, in `locale`, such as “8 October 2026”. */
export function dayOf(at: number, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(at);
}

/**
 * The time zone `timeZone`, an IANA name, by its city and its name in `locale`, such as
 * “Brussels (Central European Time)”; where Intl has no name for a zone, its offset, such as
 * “GMT+03:00”, takes the name's place. The city is the last part of the IANA name, with spaces
 * for its underscores: Intl doesn't translate cities, so it stays as the IANA name writes it, also
 * on a Dutch page. The name is the zone's at `at` (epoch milliseconds), now unless given: a zone's
 * name follows its rules, which change over the years.
 */
export function timeZoneName(timeZone: string, locale: string, at = Date.now()) {
  const city = (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  return zone === undefined ? city : m['time-zone.name']({ city, zone });
}
