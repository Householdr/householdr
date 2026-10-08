import { goto } from '$app/navigation';
import { onMount } from 'svelte';
import { languageName } from '#lib/intl.js';
import { passkeysSupported } from '#lib/hooks/use-passkeys.svelte.js';

/** A field of the new account of someone accepting an invitation, by its endpoints' name. */
export type JoinField = 'name' | 'language' | 'terms';

/** The fields in the order the form shows them, which its error summary follows. */
const order: JoinField[] = ['name', 'language', 'terms'];

/**
 * Fills in the new account of someone accepting an invitation, and creates it with a passkey to
 * join the household (ADR-0010 §1, §5). The name starts as the profile's, which the person can
 * change, and the language as the browser's where it is offered. The passkey is made with the
 * browser's own WebAuthn (PRIN-4); a browser without it can't create the account, which the page
 * says.
 */
export function useInvitationSignUp(profile: string, languages: readonly string[]) {
  const fields = $state({ name: profile, language: languages[0] ?? '', terms: false });
  /** Whether the browser can make the passkey; unknown until the page runs there. */
  let supported = $state<boolean | null>(null);
  let busy = $state(false);
  let outcome = $state<'invalid' | 'expired' | 'invitation' | 'not-created' | null>(null);
  let invalid = $state<JoinField[]>([]);
  // Every refused attempt counts, so its error summary appears, and takes the focus, anew.
  let attempts = $state(0);

  onMount(() => {
    supported = passkeysSupported();
    const language = navigator.languages
      .map((tag) => tag.split('-')[0]?.toLowerCase() ?? '')
      .find((code) => languages.includes(code));
    if (language) fields.language = language;
  });

  const languageOptions = languages.map((code) => ({ code, name: languageName(code) }));

  /** Posts `body` to one of the endpoints. */
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
      fields?: JoinField[];
    } | null;
    if (answer?.error === 'invalid') {
      outcome = 'invalid';
      invalid = order.filter((field) => answer.fields?.includes(field));
    } else if (answer?.error === 'expired' || answer?.error === 'invitation') {
      outcome = answer.error;
    } else {
      outcome = 'not-created';
    }
    attempts += 1;
  }

  /**
   * Checks the fields on the server, has the browser make the passkey, then creates the account
   * with it, joins, and goes to the household, signed in.
   */
  async function join() {
    if (busy) return;
    busy = true;
    outcome = null;
    invalid = [];
    try {
      const started = await post('/invitation/passkey/options', fields);
      if (!started.ok) {
        await refused(started);
        return;
      }
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
        (await started.json()) as PublicKeyCredentialCreationOptionsJSON,
      );
      const credential = await navigator.credentials.create({ publicKey });
      if (!(credential instanceof PublicKeyCredential)) throw new Error('No passkey made.');
      const finished = await post('/invitation/passkey', {
        ...fields,
        response: credential.toJSON(),
      });
      if (!finished.ok) {
        await refused(finished);
        return;
      }
      const { household } = (await finished.json()) as { household: string };
      await goto(`/households/${household}`);
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
    languageOptions,
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
    join,
  };
}
