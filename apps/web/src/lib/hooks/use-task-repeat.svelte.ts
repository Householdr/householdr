import { onMount } from 'svelte';

/**
 * Which fields of a task's form apply to how often it is done (CODE-9): on a frequency, what
 * happens if it isn't done and whether it is done at set times, with their window if so; counted
 * from when it was last done, how long after (ADR-0004 §3, §4, §8). Until the page runs scripts,
 * or without them, all show, and the server takes those that apply. `initial` and `initialWhen` are
 * the choices the form shows; a form that is reset goes back to them.
 */
export function useTaskRepeat(initial: () => string, initialWhen: () => string) {
  let chosen = $state<string>();
  let chosenWhen = $state<string>();
  let running = $state(false);
  onMount(() => {
    running = true;
  });
  const counted = $derived((chosen ?? initial()) === 'since-last-done');
  const atSetTimes = $derived(!counted && (chosenWhen ?? initialWhen()) === 'set');
  return {
    /** Whether the page runs scripts, so a field that doesn't apply can be hidden and left out. */
    get running() {
      return running;
    },
    /** Whether the fields of a "since last done" task apply, rather than those of a frequency. */
    get counted() {
      return counted;
    },
    /** Whether a window of set times applies (ADR-0004 §4, clarification). */
    get atSetTimes() {
      return atSetTimes;
    },
    /** Follows the choice of when it is done. */
    chooseWhen: (event: Event) => {
      if (event.currentTarget instanceof HTMLInputElement) chosenWhen = event.currentTarget.value;
    },
    /** Follows the choice of how often. */
    choose: (event: Event) => {
      if (event.currentTarget instanceof HTMLSelectElement) chosen = event.currentTarget.value;
    },
    /** Follows a reset of the form, as after a task is added. */
    resetWith: (select: HTMLSelectElement) => {
      const reset = () => {
        chosen = undefined;
        chosenWhen = undefined;
      };
      select.form?.addEventListener('reset', reset);
      return () => select.form?.removeEventListener('reset', reset);
    },
  };
}
