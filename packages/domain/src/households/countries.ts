/**
 * The countries a household can be in: those of the EU and the EEA (ADR-0016 §1, ADR-0007 §2),
 * each with the time zones of its territory in the EU or EEA, by their IANA names. Overseas
 * regions that are part of the EU, such as Réunion or the Canary Islands, are their country's.
 */
const timeZones = {
  AT: ['Europe/Vienna'],
  BE: ['Europe/Brussels'],
  BG: ['Europe/Sofia'],
  CY: ['Asia/Nicosia', 'Asia/Famagusta'],
  CZ: ['Europe/Prague'],
  DE: ['Europe/Berlin', 'Europe/Busingen'],
  DK: ['Europe/Copenhagen'],
  EE: ['Europe/Tallinn'],
  ES: ['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary'],
  FI: ['Europe/Helsinki', 'Europe/Mariehamn'],
  FR: [
    'Europe/Paris',
    'America/Cayenne',
    'America/Guadeloupe',
    'America/Marigot',
    'America/Martinique',
    'Indian/Mayotte',
    'Indian/Reunion',
  ],
  GR: ['Europe/Athens'],
  HR: ['Europe/Zagreb'],
  HU: ['Europe/Budapest'],
  IE: ['Europe/Dublin'],
  IS: ['Atlantic/Reykjavik'],
  IT: ['Europe/Rome'],
  LI: ['Europe/Vaduz'],
  LT: ['Europe/Vilnius'],
  LU: ['Europe/Luxembourg'],
  LV: ['Europe/Riga'],
  MT: ['Europe/Malta'],
  NL: ['Europe/Amsterdam'],
  NO: ['Europe/Oslo'],
  PL: ['Europe/Warsaw'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira'],
  RO: ['Europe/Bucharest'],
  SE: ['Europe/Stockholm'],
  SI: ['Europe/Ljubljana'],
  SK: ['Europe/Bratislava'],
} as const satisfies Record<string, readonly string[]>;

/** A country a household can be in, by its ISO 3166-1 alpha-2 code, such as `BE`. */
export type Country = keyof typeof timeZones;

/** Every country a household can be in, in alphabetical order of their codes. */
export const countries = Object.keys(timeZones) as Country[];

/** Whether `code` is a country a household can be in. */
export function isCountry(code: string): code is Country {
  return Object.hasOwn(timeZones, code);
}

/** The time zones of `country`, its mainland's first. */
export function timeZonesOf(country: Country): readonly string[] {
  return timeZones[country];
}

/**
 * The country whose time zone `timeZone` is, if it is one of theirs: what a browser's time zone
 * says about where it is, without looking up its IP address (ADR-0007 §2, ADR-0010 §9).
 */
export function countryOfTimeZone(timeZone: string): Country | undefined {
  return countries.find((country) => (timeZones[country] as readonly string[]).includes(timeZone));
}
