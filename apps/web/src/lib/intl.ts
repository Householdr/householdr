// Names the browser's own Intl knows, in the reader's language, so none is written by hand
// (ADR-0008 §6, UI-22).

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

/** `percent` (such as 36) as a percentage in `locale`, such as “36%” or “36 %”. */
export function percentage(percent: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent' }).format(percent / 100);
}
