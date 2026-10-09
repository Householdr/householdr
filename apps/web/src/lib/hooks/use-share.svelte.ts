import { onMount } from 'svelte';

/**
 * Shares a link through the device's own share sheet where the browser has one, such as an
 * invitation link to a messaging app (ADR-0010 §5); elsewhere nothing is offered (PRIN-5).
 */
export function useShare() {
  let supported = $state(false);

  // Only a browser can tell, so the button appears once the page runs there.
  onMount(() => {
    supported = typeof navigator.share === 'function';
  });

  async function share(data: ShareData) {
    try {
      await navigator.share(data);
    } catch {
      // Cancelled, or refused by the browser: the link is still there to copy.
    }
  }

  return {
    get supported() {
      return supported;
    },
    share,
  };
}
