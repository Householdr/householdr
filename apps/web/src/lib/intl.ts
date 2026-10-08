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

/**
 * The calendar day `date` (`YYYY-MM-DD`) in `locale`, such as “Thursday, October 8, 2026”. It is
 * already a day in the household's time zone, such as a planned absence's, so no zone shifts it.
 */
export function calendarDay(date: string, locale: string) {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  return format.format(Date.UTC(year, month - 1, day));
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

/** `percent` (such as 36) as a percentage in `locale`, such as “36%” or “36 %”. */
export function percentage(percent: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent' }).format(percent / 100);
}

/** The days from `first` to `last` (`YYYY-MM-DD`) in `locale`, such as “12–18 October 2026”. */
export function calendarDays(first: string, last: string, locale: string) {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
  return format.formatRange(utc(first), utc(last));
}

// A calendar day as the instant it starts in UTC, which formats as that day in UTC.
const utc = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

/** A number of minutes in words, in `locale`, such as “30 minutes”. */
export function minutesText(minutes: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'long',
  }).format(minutes);
}

/** A burden factor with one decimal, in `locale`, such as “1.6” (ADR-0003 §1). */
export function factorText(factor: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(factor);
}
