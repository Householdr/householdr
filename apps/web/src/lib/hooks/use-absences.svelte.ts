import type { SubmitFunction } from '$app/forms';
import { calendarDay } from '#lib/intl.js';
import { getLocale } from '#lib/paraglide/runtime.js';

/**
 * What the page of who is away needs besides its data (CODE-9): days in the reader's language
 * (UI-22), and the focus kept once a removed absence takes its button with it (UI-7).
 */
export function useAbsences() {
  const locale = getLocale();
  return {
    /** A day, `YYYY-MM-DD`, in words. */
    day: (date: string) => calendarDay(date, locale),
    /** Removes an absence, then moves the focus to `target`, its member's heading. */
    removeThenFocus:
      (target: () => HTMLElement | undefined): SubmitFunction =>
      () =>
      async ({ update }) => {
        await update();
        target()?.focus();
      },
  };
}
