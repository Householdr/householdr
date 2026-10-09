import { goto } from '$app/navigation';
import { countries, countryOfTimeZone, isCountry, timeZonesOf } from '@householdr/domain';
import { onMount } from 'svelte';
import { countryName, languageName, timeZoneName, weekdayName } from '#lib/intl.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import { passkeysSupported } from '#lib/hooks/use-passkeys.svelte.js';

/** A field of the first step of onboarding, by the name its endpoints give it. */
export type SetupField =
  | 'name'
  | 'country'
  | 'timeZone'
  | 'language'
  | 'weekStartDay'
  | 'headName'
  | 'headLanguage'
  | 'adult'
  | 'terms';

/** The fields in the order the form shows them, which its error summary follows. */
const order: SetupField[] = [
  'name',
  'country',
  'timeZone',
  'language',
  'weekStartDay',
  'headName',
  'headLanguage',
  'adult',
  'terms',
];

/**
 * Fills in the first step of onboarding and creates the household with a passkey (ADR-0007 §2,
 * ADR-0010 §1, §3). The country and time zone come from the browser's time zone, never its IP
 * address, and the languages from the browser's where they are offered; the head confirms them.
 * The passkey is made with the browser's own WebAuthn (PRIN-4); a browser without it can't create
 * the household, which the page says.
 */
export function useHouseholdSetup(languages: readonly string[]) {
  // Before there is an account, values are written in the page's language alone (ADR-0008 §6).
  const locale = getLocale();
  const offered = languages[0] ?? '';
  const fields = $state({
    name: '',
    country: '',
    timeZone: '',
    language: offered,
    // A select's value: 1 is Monday, the default (ADR-0007 §2).
    weekStartDay: '1',
    headName: '',
    headLanguage: offered,
    adult: false,
    terms: false,
  });
  /** Whether the browser can make the passkey; unknown until the page runs there. */
  let supported = $state<boolean | null>(null);
  let busy = $state(false);
  let outcome = $state<'invalid' | 'expired' | 'not-created' | null>(null);
  let invalid = $state<SetupField[]>([]);
  // Every refused attempt counts, so its error summary appears, and takes the focus, anew.
  let attempts = $state(0);

  onMount(() => {
    supported = passkeysSupported();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const country = countryOfTimeZone(timeZone);
    if (country && !fields.country) {
      fields.country = country;
      fields.timeZone = timeZone;
    }
    const language = navigator.languages
      .map((tag) => tag.split('-')[0]?.toLowerCase() ?? '')
      .find((code) => languages.includes(code));
    if (language) {
      fields.language = language;
      fields.headLanguage = language;
    }
  });

  const collator = new Intl.Collator(locale);
  const countryOptions = countries
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const languageOptions = languages.map((code) => ({ code, name: languageName(code) }));
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, name: weekdayName(day, locale) }));
  // The chosen country's time zones, its main one first.
  const timeZones = $derived(
    (isCountry(fields.country) ? timeZonesOf(fields.country) : []).map((timeZone) => ({
      timeZone,
      name: timeZoneName(timeZone, locale),
    })),
  );

  /** Posts `body` to one of the step's endpoints. */
  const post = (path: string, body: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** What an endpoint's refusal means for the page. */
  async function refused(response: Response) {
    const answer = (await response.json().catch(() => null)) as {
      error?: string;
      fields?: SetupField[];
    } | null;
    if (answer?.error === 'invalid') {
      outcome = 'invalid';
      invalid = order.filter((field) => answer.fields?.includes(field));
    } else if (answer?.error === 'expired') {
      outcome = 'expired';
    } else {
      outcome = 'not-created';
    }
    attempts += 1;
  }

  /**
   * Checks the fields on the server, has the browser make the passkey, then creates the household
   * with it and goes to the security page, signed in.
   */
  async function create() {
    if (busy) return;
    busy = true;
    outcome = null;
    invalid = [];
    const body = { ...fields, weekStartDay: Number(fields.weekStartDay) };
    try {
      const started = await post('/sign-up/household/passkey/options', body);
      if (!started.ok) {
        await refused(started);
        return;
      }
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
        (await started.json()) as PublicKeyCredentialCreationOptionsJSON,
      );
      const credential = await navigator.credentials.create({ publicKey });
      if (!(credential instanceof PublicKeyCredential)) throw new Error('No passkey made.');
      const finished = await post('/sign-up/household/passkey', {
        ...body,
        response: credential.toJSON(),
      });
      if (!finished.ok) {
        await refused(finished);
        return;
      }
      // The new household (ADR-0005 §1). Signed in now, every page's data loads anew, such as the
      // locale the root layout writes values in for the account (ADR-0008 §6).
      await goto('/', { invalidateAll: true });
    } catch {
      // Cancelled, timed out, or refused by the browser or the authenticator.
      outcome = 'not-created';
      attempts += 1;
    } finally {
      busy = false;
    }
  }

  return {
    fields,
    countryOptions,
    languageOptions,
    weekdays,
    get timeZones() {
      return timeZones;
    },
    /** Chooses a country, and its main time zone with it. */
    chooseCountry: (country: string) => {
      fields.country = country;
      fields.timeZone = isCountry(country) ? (timeZonesOf(country)[0] ?? '') : '';
    },
    get supported() {
      return supported;
    },
    get outcome() {
      return outcome;
    },
    /** The fields the server refused, in the order the form shows them. */
    get invalid() {
      return invalid;
    },
    get attempts() {
      return attempts;
    },
    create,
  };
}
