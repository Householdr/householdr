import { refreshAll } from '$app/navigation';
import { onMount } from 'svelte';

/**
 * Whether the browser makes and uses passkeys through WebAuthn's JSON form, which the app's
 * passkey steps need. Only a browser can tell.
 */
export const passkeysSupported = () =>
  typeof PublicKeyCredential !== 'undefined' &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
  typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function';

/**
 * Adds passkeys and signs in with them, with the browser's own WebAuthn where the browser can
 * (ADR-0010 §2, PRIN-4); elsewhere nothing is offered, and the password stays (PRIN-5).
 */
export function usePasskeys() {
  let supported = $state(false);
  let busy = $state(false);
  let outcome = $state<'added' | 'not-added' | 'not-signed' | null>(null);
  // Every failed attempt counts, so its error summary appears, and takes the focus, anew.
  let attempts = $state(0);

  // Only a browser can tell, so the buttons appear once the page runs there.
  onMount(() => {
    supported = passkeysSupported();
  });

  /** Posts `body` to one of the security page's passkey endpoints. */
  const post = (path: string, body?: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  async function add() {
    if (busy) return;
    busy = true;
    outcome = null;
    try {
      const started = await post('/security/passkeys/options');
      if (started.ok) {
        const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
          (await started.json()) as PublicKeyCredentialCreationOptionsJSON,
        );
        const credential = await navigator.credentials.create({ publicKey });
        if (!(credential instanceof PublicKeyCredential)) throw new Error('No passkey made.');
        const finished = await post('/security/passkeys', { response: credential.toJSON() });
        // A 403 means the sign-in is no longer recent: loaded again, the page asks to confirm.
        if (finished.ok) outcome = 'added';
        else if (finished.status !== 403) outcome = 'not-added';
      } else if (started.status !== 403) {
        outcome = 'not-added';
      }
      await refreshAll();
    } catch {
      // Cancelled, timed out, or refused by the browser or the authenticator.
      outcome = 'not-added';
    } finally {
      busy = false;
    }
  }

  /**
   * Has a passkey sign the challenge from `path`/options and sends it to `path`: to sign in, or to
   * confirm it's you. Says whether it was accepted.
   */
  async function sign(path: string) {
    if (busy) return false;
    busy = true;
    outcome = null;
    try {
      const started = await post(`${path}/options`);
      if (!started.ok) throw new Error('No challenge.');
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
        (await started.json()) as PublicKeyCredentialRequestOptionsJSON,
      );
      const credential = await navigator.credentials.get({ publicKey });
      if (!(credential instanceof PublicKeyCredential)) throw new Error('No passkey used.');
      const finished = await post(path, { response: credential.toJSON() });
      if (!finished.ok) throw new Error('Not accepted.');
      return true;
    } catch {
      // Cancelled, timed out, refused by the authenticator, or not accepted.
      outcome = 'not-signed';
      attempts += 1;
      return false;
    } finally {
      busy = false;
    }
  }

  return {
    get supported() {
      return supported;
    },
    get busy() {
      return busy;
    },
    get outcome() {
      return outcome;
    },
    get attempts() {
      return attempts;
    },
    add,
    sign,
    /** Forgets the last outcome, once another change has its own to show. */
    clear() {
      outcome = null;
    },
  };
}
