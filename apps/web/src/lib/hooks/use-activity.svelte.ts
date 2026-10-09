import { dayOf, listOf } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { ActivityEntry, SetBeforeStartNames } from '@householdr/application';

/** An entry of the activity log, as page data: when it was, in epoch milliseconds. */
export interface ActivityEntryData {
  id: string;
  at: number;
  actor: string | null;
  action: ActivityEntry['action'];
  setBeforeStart: SetBeforeStartNames | null;
}

/** An entry in words: what was done, what else it lists, if anything, and on which day. */
export interface ShownEntry {
  id: string;
  said: string;
  detail: string | null;
  day: string;
}

/**
 * What the activity page needs besides its data (CODE-9): each entry in words, who did what
 * (ADR-0018 §5), never a value; a former member without a name (ADR-0012 §6); and the day only,
 * never the time, since when someone is active isn't shared (ADR-0018 §3).
 */
export function useActivity(data: () => { timeZone: string; entries: ActivityEntryData[] }) {
  const locale = getLocale();

  const said = (entry: ActivityEntryData) => {
    const actor = entry.actor ?? m['activity.former-member']();
    switch (entry.action) {
      case 'household.name':
        return m['activity.household-name']({ actor });
      case 'household.country':
        return m['activity.household-country']({ actor });
      case 'household.timeZone':
        return m['activity.household-time-zone']({ actor });
      case 'household.language':
        return m['activity.household-language']({ actor });
      case 'household.started':
        return m['activity.household-started']({ actor });
    }
  };

  /** What the start entry lists as set for others before the start, by name (ADR-0007 §2). */
  const detail = (set: SetBeforeStartNames | null) => {
    if (!set) return null;
    const names = (list: (string | null)[]) =>
      listOf(
        list.map((name) => name ?? m['activity.a-former-member']()),
        locale,
      );
    const [shares, daysAway] = [names(set.shares), names(set.daysAway)];
    if (set.shares.length > 0 && set.daysAway.length > 0) {
      return m['activity.set-before-start']({ shares, daysAway });
    }
    if (set.shares.length > 0) return m['activity.set-before-start-shares']({ shares });
    if (set.daysAway.length > 0) return m['activity.set-before-start-days-away']({ daysAway });
    return null;
  };

  const entries = $derived.by((): ShownEntry[] => {
    const { timeZone, entries: list } = data();
    return list.map((entry) => ({
      id: entry.id,
      said: said(entry),
      detail: detail(entry.setBeforeStart),
      day: dayOf(entry.at, timeZone, locale),
    }));
  });

  return {
    get entries() {
      return entries;
    },
  };
}
