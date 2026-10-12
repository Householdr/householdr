import { onNavigate } from '$app/navigation';
import { directionOf } from '#lib/page-depth.js';

/**
 * Page transitions by depth (ADR-0008 §7, clarification): a deeper page comes in over this one from
 * the end side, and going back up, this one slides off to it; pages at the same depth just change.
 * The browser's View Transitions draw it, where there are any; app.css says how. Never under
 * `prefers-reduced-motion` (UI-13, ADR-0011), and only while `enabled` says so (CODE-20).
 */
export function usePageTransitions(enabled: () => boolean) {
  onNavigate((navigation) => {
    if (!enabled() || !navigation.from || !navigation.to) return;
    if (!('startViewTransition' in document)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const direction = directionOf(navigation.from.url, navigation.to.url);
    if (!direction) return;
    const root = document.documentElement;
    root.dataset.transition = direction;
    return new Promise<void>((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
      void transition.finished.finally(() => {
        delete root.dataset.transition;
      });
    });
  });
}
