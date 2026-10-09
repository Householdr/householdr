import { calendarDays, signed } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { RebalancePreset } from '@householdr/application';

/** A member's balance and its history, as page data: weeks as `YYYY-MM-DD`, points as numbers. */
export interface BalanceData {
  id: string;
  name: string;
  balance: number;
  /** Newest first: each week's first and last day, and what it changed the balance by. */
  history: { start: string; last: string; change: number }[];
}

/** A member's balance as the page shows it, all in words. */
export interface ShownBalance {
  id: string;
  /** Their name, which says "you" for the reader. */
  heading: string;
  balance: string;
  /** Newest first. */
  history: { start: string; week: string; change: string }[];
}

/** How fast the plans even balances out, by the household's rebalance rate (ADR-0002 §3). */
const rates: Record<RebalancePreset, () => string> = {
  fast: m['balances.rate-fast'],
  normal: m['balances.rate-normal'],
  slow: m['balances.rate-slow'],
};

/**
 * What the balances page needs besides its data (CODE-9): every member's balance and each week's
 * change in whole points with their sign (ADR-0002 §6), weeks in the reader's language (UI-22), and
 * how fast this household evens balances out (§3).
 */
export function useBalances(
  data: () => { you: string; rebalance: RebalancePreset; members: BalanceData[] },
) {
  const locale = getLocale();

  /** Points in words, whole, a half rounded away from 0 so a change and its opposite look alike. */
  const points = (value: number) => {
    const whole = Math.sign(value) * Math.round(Math.abs(value));
    return m['balances.points']({ count: whole, points: signed(whole, locale) });
  };

  const members = $derived.by((): ShownBalance[] => {
    const { you, members: list } = data();
    return list.map(({ id, name, balance, history }) => ({
      id,
      heading: id === you ? m['household.you']({ name }) : name,
      balance: points(balance),
      history: history.map((week) => ({
        start: week.start,
        week: calendarDays(week.start, week.last, locale),
        change: points(week.change),
      })),
    }));
  });
  const rate = $derived(rates[data().rebalance]());

  return {
    get members() {
      return members;
    },
    get rate() {
      return rate;
    },
  };
}
