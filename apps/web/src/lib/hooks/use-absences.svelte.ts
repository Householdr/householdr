import type { SubmitFunction } from '$app/forms';
import { calendarDay, weekDay } from '#lib/intl.js';

/**
 * What the page of who is away needs besides its data (CODE-9): days in the reader's language with
 * their account's conventions, `locale` (UI-22, ADR-0008 §6), and the focus kept once a removed
 * absence takes its button with it (UI-7).
 */
export function useAbsences(locale: () => string) {
  return {
    /** A day, `YYYY-MM-DD`, in words. */
    day: (date: string) => calendarDay(date, locale()),
    /** A day of this week, `YYYY-MM-DD`, in words with its weekday, such as “Friday 9 October”. */
    weekDay: (date: string) => weekDay(date, locale()),
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
