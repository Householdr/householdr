import type { SubmitFunction } from '$app/forms';
import { onMount } from 'svelte';
import { scheduleWords } from '#lib/schedule-words.js';
import { scheduleSoFar, sentSchedule, type ScheduleValues } from '#lib/task-schedule.js';

/**
 * The advanced schedule editor's state (CODE-9; ADR-0004 §3): which fields of each rule apply to
 * its kind, and the schedule in words as it is built. Until the page runs scripts, or without
 * them, every field of a rule shows, the server takes those of its kind, and the words are those
 * of the schedule `initial` gives. A form that is reset goes back to it.
 */
export function useScheduleEditor(initial: () => ScheduleValues, locale: () => string) {
  let running = $state(false);
  let kinds = $state<Record<number, string>>({});
  let sent = $state<ScheduleValues>();
  onMount(() => {
    running = true;
  });
  const words = $derived.by(() => {
    const schedule = scheduleSoFar(sent ?? initial());
    const some = schedule.rules.length + schedule.extraDates.length > 0;
    return some ? scheduleWords(schedule, locale()) : '';
  });
  return {
    /** Whether the page runs scripts, so a field that doesn't apply can be hidden and left out. */
    get running() {
      return running;
    },
    /** The schedule in words so far, or nothing while no rule or date is complete. */
    get words() {
      return words;
    },
    /** Whether a field for rules of `kind` applies to rule `index`: always, until scripts run. */
    applies: (index: number, ...kind: string[]) =>
      !running || kind.includes(kinds[index] ?? initial().rules[index]?.kind ?? ''),
    /** Follows the choice of rule `index`'s kind. */
    chooseKind: (index: number) => (event: Event) => {
      if (event.currentTarget instanceof HTMLSelectElement) {
        kinds[index] = event.currentTarget.value;
      }
    },
    /** Reads the schedule again from the form of the editor, whose fields just changed. */
    follow: (event: Event) => {
      if (event.currentTarget instanceof HTMLElement) {
        const form = event.currentTarget.closest('form');
        if (form) sent = sentSchedule(new FormData(form));
      }
    },
    /** Follows a reset of the form `within`, as after a task is added. */
    resetWith: (within: HTMLElement) => {
      const form = within.closest('form');
      const reset = () => {
        kinds = {};
        sent = undefined;
      };
      form?.addEventListener('reset', reset);
      return () => form?.removeEventListener('reset', reset);
    },
  };
}

/**
 * Sends a task's form with scripts (CODE-10): a button of the advanced editor shows the form again
 * with its rows changed, keeping what was typed, and moves the focus to where the change was, as
 * the link of its `formaction` does without scripts (UI-7); anything else is updated with `saved`.
 */
export function scheduleChanges(
  saved: { reset?: boolean; refreshAll?: boolean } = {},
): SubmitFunction {
  return ({ submitter, action }) =>
    async ({ update }) => {
      if (submitter?.getAttribute('name') !== 'change') return update(saved);
      await update({ reset: false });
      document.getElementById(decodeURIComponent(action.hash.slice(1)))?.focus();
    };
}
