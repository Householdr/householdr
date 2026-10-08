import { refreshAll } from '$app/navigation';
import { onMount } from 'svelte';

/**
 * Adds a passkey with the browser's own WebAuthn, where the browser can (ADR-0010 §2, PRIN-4);
 * elsewhere nothing is offered, and the password stays (PRIN-5).
 */
export function usePasskeys() {
  let supported = $state(false);
  let busy = $state(false);
  let outcome = $state<'added' | 'failed' | null>(null);

  // Only a browser can tell, so the button appears once the page runs there.
  onMount(() => {
    supported =
      typeof PublicKeyCredential !== 'undefined' &&
      typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function';
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
        else if (finished.status !== 403) outcome = 'failed';
      } else if (started.status !== 403) {
        outcome = 'failed';
      }
      await refreshAll();
    } catch {
      // Cancelled, timed out, or refused by the browser or the authenticator.
      outcome = 'failed';
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
    add,
    /** Forgets the last outcome, once another change has its own to show. */
    clear() {
      outcome = null;
    },
  };
}
