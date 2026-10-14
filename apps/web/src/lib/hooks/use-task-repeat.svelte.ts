import { onMount } from 'svelte';

/**
 * Which fields of a task's form apply to how often it is done (CODE-9): on a frequency or an
 * advanced schedule, what happens if it isn't done and whether it is done at set times, with their
 * window if so; on an advanced schedule, its rules and dates instead of a first time; counted from
 * when it was last done, how long after (ADR-0004 §3, §4, §8). Until the page runs scripts, or
 * without them, all show, and the server takes those that apply. `initial` and `initialWhen` are
 * the choices the form shows; a form that is reset goes back to them. A task that turns to an
 * advanced schedule turns to set times too, which that editor starts on (§4, clarification).
 */
export function useTaskRepeat(initial: () => string, initialWhen: () => string) {
  let chosen = $state<string>();
  let chosenWhen = $state<string>();
  let running = $state(false);
  onMount(() => {
    running = true;
  });
  const counted = $derived((chosen ?? initial()) === 'since-last-done');
  const advanced = $derived((chosen ?? initial()) === 'advanced');
  const sharing = $derived((chosen ?? initial()) === 'shared');
  const when = $derived(
    chosenWhen ?? (advanced && initial() !== 'advanced' ? 'set' : initialWhen()),
  );
  const atSetTimes = $derived(!counted && when === 'set');
  return {
    /** Whether the page runs scripts, so a field that doesn't apply can be hidden and left out. */
    get running() {
      return running;
    },
    /** Whether the fields of a "since last done" task apply, rather than those of a frequency. */
    get counted() {
      return counted;
    },
    /** Whether the fields of an advanced schedule apply, rather than a first time (ADR-0004 §3). */
    get advanced() {
      return advanced;
    },
    /** Whether it shares another task's dates, rather than having a first time (ADR-0004 §1). */
    get sharing() {
      return sharing;
    },
    /** When it is done: any time that week, or at set times. */
    get when() {
      return when;
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
