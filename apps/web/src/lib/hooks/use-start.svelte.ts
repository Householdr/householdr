import { dayAndTime, weekDay } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { StartChoice } from '@householdr/application';

/** When each choice starts the household, as page data: days `YYYY-MM-DD`, moments in ms. */
export interface StartData {
  timeZone: string;
  now: { today: string; last: string };
  weekStart: { week: string; draftAt: number; publishAt: number };
}

/** A choice of when to start, in words, with its radio's id. */
export interface StartOption {
  value: StartChoice;
  id: string;
  label: string;
  hint: string;
}

/** Why starting didn't go through, from the form action's error code. */
type StartProblem = 'invalid' | 'already-started';

const problems: Record<StartProblem, () => string> = {
  invalid: m['start.invalid'],
  'already-started': m['start.already-started'],
};

/**
 * What the Start page needs besides its data (CODE-9): the two choices of ADR-0007 §3 in the
 * reader's words, with days in their language and times in the household's time zone (UI-22), and
 * why starting didn't go through (CODE-13). No choices once the household has started.
 */
export function useStart(data: () => StartData | null) {
  const locale = getLocale();
  const options = $derived.by((): StartOption[] => {
    const shown = data();
    if (!shown) return [];
    const { timeZone, now, weekStart } = shown;
    const at = (ms: number) => dayAndTime(ms, timeZone, locale);
    return [
      {
        value: 'now',
        id: 'when-now',
        label: m['start.now'](),
        hint: m['start.now-hint']({ last: weekDay(now.last, locale) }),
      },
      {
        value: 'week start',
        id: 'when-week-start',
        label: m['start.week-start']({ day: weekDay(weekStart.week, locale) }),
        hint: m['start.week-start-hint']({
          draft: at(weekStart.draftAt),
          publish: at(weekStart.publishAt),
        }),
      },
    ];
  });

  return {
    get options() {
      return options;
    },
    /** A refusal in words. */
    problem: (code: StartProblem) => problems[code](),
  };
}
