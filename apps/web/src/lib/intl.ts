// Names the browser's own Intl knows, in the reader's language, so none is written by hand
// (ADR-0008 §6, UI-22).

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
