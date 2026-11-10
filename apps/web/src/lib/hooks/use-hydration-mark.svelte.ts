import { onMount } from 'svelte';

/**
 * Marks the document with `data-hydrated` once the app runs its scripts on it, so the end-to-end
 * tests act on a page they open only from then on (TEST-7). Until then, a field the server rendered
 * loses any text selected in it when Svelte takes it over, and what is typed next is added to its
 * text instead of replacing it.
 */
export function useHydrationMark() {
  onMount(() => {
    document.documentElement.dataset.hydrated = '';
  });
}
