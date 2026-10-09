import { onMount } from 'svelte';

/**
 * Copies text to the clipboard where the browser can, such as an invitation link (ADR-0010 §5);
 * elsewhere nothing is offered, and the text stays there to select (PRIN-5).
 */
export function useCopy() {
  let supported = $state(false);
  let copied = $state<string | null>(null);

  // Only a browser can tell, so the button appears once the page runs there.
  onMount(() => {
    // Browsers leave the clipboard out of pages that aren't served securely.
    supported = 'clipboard' in navigator && typeof navigator.clipboard.writeText === 'function';
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = text;
    } catch {
      // Refused by the browser: the text is still there to select.
      copied = null;
    }
  }

  return {
    get supported() {
      return supported;
    },
    /** The text copied last, for the status message (UI-12). */
    get copied() {
      return copied;
    },
    copy,
  };
}
