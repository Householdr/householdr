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
  subject: string | null;
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
 * What the activity page needs besides its data (CODE-9): each entry in words, who did what to
 * whom (ADR-0018 §5), never a value; a former member without a name (ADR-0012 §6); and the day only,
 * never the time, since when someone is active isn't shared (ADR-0018 §3).
 */
export function useActivity(data: () => { timeZone: string; entries: ActivityEntryData[] }) {
  const locale = getLocale();

  /** Whom an entry names, or a former member (ADR-0012 §6). */
  const subjectOf = (entry: ActivityEntryData) => entry.subject ?? m['activity.a-former-member']();

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
      // To whom, never a value such as the task's points (ADR-0018 §5).
      case 'completion.logged':
        return m['activity.completion-logged']({ actor, subject: subjectOf(entry) });
      case 'completion.undone':
        return m['activity.completion-undone']({ actor, subject: subjectOf(entry) });
      case 'completion.picked-up':
        return m['activity.completion-picked-up']({ actor, subject: subjectOf(entry) });
      // Whose, never the share or the days (ADR-0018 §5).
      case 'share.changed':
        return m['activity.share-changed']({ actor, subject: subjectOf(entry) });
      case 'temporary-share.added':
        return m['activity.temporary-share-added']({ actor, subject: subjectOf(entry) });
      case 'temporary-share.removed':
        return m['activity.temporary-share-removed']({ actor, subject: subjectOf(entry) });
      case 'absence.added':
        return m['activity.absence-added']({ actor, subject: subjectOf(entry) });
      case 'absence.removed':
        return m['activity.absence-removed']({ actor, subject: subjectOf(entry) });
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
