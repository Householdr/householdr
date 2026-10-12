import { dayOf, listOf } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { ActivityEntry, SetBeforeStartNames } from '@householdr/application';

/** An entry of the activity log, as page data: when it was, in epoch milliseconds. */
export interface ActivityEntryData {
  id: string;
  at: number;
  actor: string | null;
  action: ActivityEntry['action'];
  subject: string | null;
  setBeforeStart: SetBeforeStartNames | null;
  byReader: boolean;
  toReader: boolean;
  toActor: boolean;
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
 * whom (ADR-0018 §5), never a value, with the reader as "you" (ADR-0018 §5, clarification); a former
 * member without a name (ADR-0012 §6); and the day only, never the time, since when someone is
 * active isn't shared (ADR-0018 §3).
 */
export function useActivity(
  data: () => { timeZone: string; locale: string; entries: ActivityEntryData[] },
) {
  /** Whom an entry names, or a former member (ADR-0012 §6). */
  const subjectOf = (entry: ActivityEntryData) => entry.subject ?? m['activity.a-former-member']();

  /** Which wording an entry takes, by whether the reader is in it. */
  const whoOf = (entry: ActivityEntryData) => {
    if (entry.byReader) return entry.toReader ? 'yourself' : 'you';
    if (entry.toReader) return 'to-you';
    return entry.toActor ? 'themselves' : 'other';
  };

  const said = (entry: ActivityEntryData) => {
    const actor = entry.actor ?? m['activity.former-member']();
    const who = whoOf(entry);
    const toWhom = { who, actor, subject: subjectOf(entry) };
    switch (entry.action) {
      case 'household.name':
        return m['activity.household-name']({ who, actor });
      case 'household.country':
        return m['activity.household-country']({ who, actor });
      case 'household.timeZone':
        return m['activity.household-time-zone']({ who, actor });
      case 'household.language':
        return m['activity.household-language']({ who, actor });
      case 'household.started':
        return m['activity.household-started']({ who, actor });
      // To whom, never a value such as the task's points (ADR-0018 §5).
      case 'completion.logged':
        return m['activity.completion-logged'](toWhom);
      case 'completion.undone':
        return m['activity.completion-undone'](toWhom);
      case 'completion.picked-up':
        return m['activity.completion-picked-up'](toWhom);
      // Whose, never the share or the days (ADR-0018 §5).
      case 'share.changed':
        return m['activity.share-changed'](toWhom);
      case 'temporary-share.added':
        return m['activity.temporary-share-added'](toWhom);
      case 'temporary-share.removed':
        return m['activity.temporary-share-removed'](toWhom);
      case 'absence.added':
        return m['activity.absence-added'](toWhom);
      case 'absence.removed':
        return m['activity.absence-removed'](toWhom);
    }
  };

  /** What the start entry lists as set for others before the start, by name (ADR-0007 §2). */
  const detail = (set: SetBeforeStartNames | null, locale: string) => {
    if (!set) return null;
    // The reader first, as "you".
    const names = (list: (string | null)[], reader: boolean) => [
      ...(reader ? [m['activity.you']()] : []),
      ...list.map((name) => name ?? m['activity.a-former-member']()),
    ];
    const [shares, daysAway] = [
      names(set.shares, set.reader.shares),
      names(set.daysAway, set.reader.daysAway),
    ];
    const [sharesSaid, daysAwaySaid] = [listOf(shares, locale), listOf(daysAway, locale)];
    if (shares.length > 0 && daysAway.length > 0) {
      return m['activity.set-before-start']({ shares: sharesSaid, daysAway: daysAwaySaid });
    }
    if (shares.length > 0) return m['activity.set-before-start-shares']({ shares: sharesSaid });
    if (daysAway.length > 0) {
      return m['activity.set-before-start-days-away']({ daysAway: daysAwaySaid });
    }
    return null;
  };

  const entries = $derived.by((): ShownEntry[] => {
    const { timeZone, locale, entries: list } = data();
    return list.map((entry) => ({
      id: entry.id,
      said: said(entry),
      detail: detail(entry.setBeforeStart, locale),
      day: dayOf(entry.at, timeZone, locale),
    }));
  });

  return {
    get entries() {
      return entries;
    },
  };
}
