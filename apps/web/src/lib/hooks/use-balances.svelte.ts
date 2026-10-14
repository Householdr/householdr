import { calendarDays, signed } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { RebalancePreset } from '@householdr/application';

/**
 * A member's balance and its history, as page data: weeks as `YYYY-MM-DD`, points as numbers. A
 * former member who didn't choose their name has none (ADR-0018 §2, clarification).
 */
export interface BalanceData {
  id: string;
  name: string | null;
  balance: number;
  /** Newest first: each week's first and last day, and what it changed the balance by. */
  history: { start: string; last: string; change: number }[];
}

/** A member's balance as the page shows it, all in words. */
export interface ShownBalance {
  id: string;
  /** Their name, which says "you" for the reader, or "Former member". */
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
 * change in whole points with their sign, such as "-80 points" (ADR-0002 §6, clarification), and
 * weeks, in the page's language with the account's conventions (ADR-0008 §6, UI-22), and how fast
 * this household evens balances out (§3); and the former members' frozen ones, by name or as
 * "Former member", as each chose (ADR-0005 §4, ADR-0018 §2, clarifications).
 */
export function useBalances(
  data: () => {
    you: string;
    locale: string;
    rebalance: RebalancePreset;
    members: BalanceData[];
    former: BalanceData[];
  },
) {
  /** Points in words, whole, a half rounded away from 0 so a change and its opposite look alike. */
  const points = (value: number, locale: string) => {
    const whole = Math.sign(value) * Math.round(Math.abs(value));
    return m['balances.points']({ count: whole, points: signed(whole, locale) });
  };

  const shown = (list: BalanceData[]): ShownBalance[] => {
    const { you, locale } = data();
    return list.map(({ id, name, balance, history }) => ({
      id,
      heading:
        name === null
          ? m['balances.former-member']()
          : id === you
            ? m['household.you']({ name })
            : name,
      balance: points(balance, locale),
      history: history.map((week) => ({
        start: week.start,
        week: calendarDays(week.start, week.last, locale),
        change: points(week.change, locale),
      })),
    }));
  };
  const members = $derived(shown(data().members));
  /** After the current members, the latest to leave first (ADR-0005 §4, clarifications). */
  const former = $derived(shown(data().former));
  const rate = $derived(rates[data().rebalance]());

  return {
    get members() {
      return members;
    },
    get former() {
      return former;
    },
    get rate() {
      return rate;
    },
  };
}
