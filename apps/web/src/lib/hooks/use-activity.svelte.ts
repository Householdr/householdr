import { listOf } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { pastDayWords, type PastDayWords } from '#lib/past-day.js';
import type { ActivityEntry, PastDay, SetBeforeStartNames } from '@householdr/application';

/** An entry of the activity log, as page data: the day it was, as `YYYY-MM-DD`, and how long ago. */
export interface ActivityEntryData {
  id: string;
  day: string;
  when: PastDay;
  actor: string | null;
  action: ActivityEntry['action'];
  subject: string | null;
  task: string | null;
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
  day: PastDayWords;
}

/**
 * What the activity page needs besides its data (CODE-9): each entry in words, who did what to
 * whom (ADR-0018 §5), never a value, with the reader as "you" (ADR-0018 §5, clarification); a former
 * member without a name (ADR-0012 §6); and the day only, never the time, since when someone is
 * active isn't shared (ADR-0018 §3), said vaguely, such as “Last week” (ADR-0008 §6, clarification).
 */
export function useActivity(data: () => { locale: string; entries: ActivityEntryData[] }) {
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
      // That it happened, never the days (ADR-0018 §5, clarification).
      case 'away.added':
        return m['activity.away-added']({ who, actor });
      case 'away.removed':
        return m['activity.away-removed']({ who, actor });
      // The task by its name, which every member sees in the task list (ADR-0018 §5, clarification).
      case 'one-off.added':
        return m['activity.one-off-added']({ who, actor, task: entry.task ?? '' });
      case 'one-off.removed':
        return m['activity.one-off-removed']({ who, actor, task: entry.task ?? '' });
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
    const { locale, entries: list } = data();
    return list.map((entry) => ({
      id: entry.id,
      said: said(entry),
      detail: detail(entry.setBeforeStart, locale),
      day: pastDayWords(entry.when, entry.day, locale),
    }));
  });

  return {
    get entries() {
      return entries;
    },
  };
}
