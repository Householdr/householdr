import { countries, isCountry, timeZonesOf } from '@householdr/domain';
import { countryName, languageName } from '#lib/intl.js';
import { getLocale } from '#lib/paraglide/runtime.js';

/** The settings the form shows: the saved ones, or what was entered (UI-10). */
interface Shown {
  country: string;
  timeZone: string;
}

/**
 * The choices of the household's settings (ADR-0007 §2): every country by its name, the chosen
 * country's time zones, and the offered languages. Choosing another country chooses its main time
 * zone; without JavaScript, the server asks for one of the new country's instead.
 */
export function useHouseholdSettings(shown: () => Shown, languages: readonly string[]) {
  const locale = getLocale();
  const chosen = $state({ country: shown().country, timeZone: shown().timeZone });
  // When the page loads other values, such as after saving, the form shows them.
  $effect.pre(() => {
    const { country, timeZone } = shown();
    chosen.country = country;
    chosen.timeZone = timeZone;
  });

  const collator = new Intl.Collator(locale);
  const countryOptions = countries
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const languageOptions = languages.map((code) => ({ code, name: languageName(code) }));
  const timeZones = $derived(isCountry(chosen.country) ? timeZonesOf(chosen.country) : []);

  return {
    chosen,
    countryOptions,
    languageOptions,
    get timeZones() {
      return timeZones;
    },
    /** Chooses a country, and its main time zone with it. */
    chooseCountry: (country: string) => {
      chosen.country = country;
      chosen.timeZone = isCountry(country) ? (timeZonesOf(country)[0] ?? '') : '';
    },
    /** A country's name, in the reader's language. */
    countryName: (code: string) => countryName(code, locale),
  };
}
