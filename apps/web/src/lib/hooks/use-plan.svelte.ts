import type { SubmitFunction } from '$app/forms';
import { tick } from 'svelte';
import { calendarDays, dayAndTime, listOf, timeOf, weekDay } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { Reason, UnassignedCause } from '@householdr/application';

/** A member a completion names. */
interface Named {
  id: string;
  name: string;
}

/** A task of a week's plan, as page data. */
interface ItemData {
  id: string;
  occurrence: string;
  task: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Whether the reader may mark it done now. */
  completable: boolean;
  completion: {
    id: string;
    /** `YYYY-MM-DD`. */
    day: string;
    /** Epoch milliseconds, for those it credits only (ADR-0018 §3). */
    at: number | null;
    doers: Named[];
    loggedBy: Named;
    mayUndo: boolean;
  } | null;
}

/** A week's plan, as page data. */
export interface WeekData {
  start: string;
  last: string;
  status: 'draft' | 'published';
  version: number;
  publishAt: number | null;
  members: {
    id: string;
    name: string;
    assignments: (ItemData & { cost: number | null; reason: Reason })[];
  }[];
  unassigned: (ItemData & { cause: UnassignedCause })[];
}

/** A member the reader can say did a task, and whether the form starts with them chosen. */
interface Choice {
  id: string;
  name: string;
  checked: boolean;
}

/**
 * A task as the plan shows it: its day in words, its points for the reader, and why; once done, by
 * whom and when; and while it can be, how to mark it done (ADR-0006 §4).
 */
export interface ShownItem {
  id: string;
  /** What its controls' ids start with: unique on the page. */
  key: string;
  occurrence: string;
  task: string;
  date: string;
  day: string;
  /** Whether `day` says "any day" of the week rather than naming one. */
  anyDay: boolean;
  points: string | null;
  why: string;
  /** Who did it and when, who logged it if not only they did, and undoing it, if the reader may. */
  done: {
    said: string;
    loggedBy: string | null;
    undo: { completion: string; label: string } | null;
  } | null;
  /**
   * While it can be marked done: one tap for the reader's own task, and the choice of who did it,
   * starting with its assignee, or the reader for a task nobody has.
   */
  complete: {
    /** The one-tap button's name, on the reader's own task only. */
    own: string | null;
    summary: string;
    label: string;
    choices: Choice[];
    /** Why the choice wasn't accepted, which opens it. */
    problem: string | null;
  } | null;
}

/** A week's plan as the page shows it, all in words. */
export interface ShownWeek {
  /** Its heading's id. */
  id: string;
  /** Its first day, `YYYY-MM-DD`, which publishing's outcome names. */
  start: string;
  heading: string;
  /** For heads, while it is a draft: who sees it, and until when. */
  draft: string | null;
  /** What publishing it early sends, for a head who may. */
  publish: { week: string; version: number } | null;
  members: { id: string; heading: string; items: ShownItem[] }[];
  unassigned: ShownItem[];
}

/** What the last form sent about a task came to, as the plan's action answers. */
export interface ItemOutcome {
  occurrence?: string;
  completed?: boolean;
  undone?: boolean;
  problem?: string;
  doers?: Named[];
}

/** Why an occurrence went to someone else, and to the reader (ADR-0001 §7, ADR-0007 §5). */
const reasons: Record<Reason, { other: (name: string) => string; you: () => string }> = {
  'lowest relative load': {
    other: (name) => m['plan.reason.lowest-relative-load']({ name }),
    you: m['plan.reason.lowest-relative-load-you'],
  },
  'only eligible member': {
    other: (name) => m['plan.reason.only-eligible']({ name }),
    you: m['plan.reason.only-eligible-you'],
  },
  'catching up': { other: () => m['plan.reason.catching-up'](), you: m['plan.reason.catching-up'] },
  bound: { other: (name) => m['plan.reason.bound']({ name }), you: m['plan.reason.bound-you'] },
  'assigned by head': {
    other: (name) => m['plan.reason.assigned-by-head']({ name }),
    you: m['plan.reason.assigned-by-head-you'],
  },
  linked: { other: (name) => m['plan.reason.linked']({ name }), you: m['plan.reason.linked-you'] },
};

/** Why nobody has an occurrence, for heads (ADR-0001 §7, clarification). */
const causes: Record<UnassignedCause, () => string> = {
  'nobody eligible': m['plan.cause.nobody-eligible'],
  'bound member not eligible': m['plan.cause.bound-member-not-eligible'],
  'linked member not eligible': m['plan.cause.linked-member-not-eligible'],
};

/**
 * What the plan's page needs besides its data (CODE-9): this week's and next week's plans in the
 * reader's words, with days in their language and times in the household's time zone (UI-22), and
 * the focus kept once publishing takes its button with it (UI-7).
 */
export function usePlan(
  data: () => {
    timeZone: string;
    you: string;
    mayPublish: boolean;
    thisWeek: WeekData | null;
    nextWeek: WeekData | null;
  },
  outcome: () => ItemOutcome | null | undefined,
) {
  const locale = getLocale();

  /** Members by name, the reader as “you” (UI-21). */
  const names = (list: readonly Named[]) =>
    listOf(
      list.map(({ id, name }) => (id === data().you ? m['plan.you']() : name)),
      locale,
    );

  /** Who did it and when: the time for those it credits only (ADR-0018 §3). */
  const doneOf = (done: NonNullable<ItemData['completion']>, task: string, day: string) => {
    const { timeZone, you } = data();
    const when = weekDay(done.day, locale);
    const doers = names(done.doers);
    const alone = done.doers.length === 1 && done.doers[0]?.id === done.loggedBy.id;
    return {
      said:
        done.at === null
          ? m['plan.done']({ day: when, doers })
          : m['plan.done-at']({ day: when, time: timeOf(done.at, timeZone, locale), doers }),
      loggedBy: alone
        ? null
        : m['plan.logged-by']({
            name: done.loggedBy.id === you ? m['plan.you']() : done.loggedBy.name,
          }),
      undo: done.mayUndo
        ? { completion: done.id, label: m['plan.undo-label']({ task, day }) }
        : null,
    };
  };

  /** Why the choice of who did a task wasn't accepted, if the last form sent it. */
  const choiceProblem = (occurrence: string) => {
    const last = outcome();
    return last?.occurrence === occurrence && last.problem === 'no-doers'
      ? m['plan.no-doers']()
      : null;
  };

  const shown = (
    week: WeekData,
    id: string,
    heading: (days: string) => string,
    anyDay: () => string,
  ): ShownWeek => {
    const { timeZone, you, mayPublish } = data();
    const draft = week.status === 'draft';
    const people = week.members.map(({ id: member, name }) => ({
      id: member,
      name: member === you ? m['household.you']({ name }) : name,
    }));
    const item = (row: ItemData, assignee: string | null) => {
      // A task from an earlier week, carried over or floating on, can be done any day of this one:
      // its own date, in a week gone by, would only confuse (ADR-0002 §2, ADR-0004 §4).
      const earlier = row.date < week.start;
      const day = earlier ? anyDay() : weekDay(row.date, locale);
      return {
        id: row.id,
        key: `${id}-${row.occurrence}`,
        occurrence: row.occurrence,
        task: row.task,
        date: row.date,
        day,
        anyDay: earlier,
        done: row.completion && doneOf(row.completion, row.task, day),
        complete: row.completable
          ? {
              own: assignee === you ? m['plan.done-label']({ task: row.task, day }) : null,
              summary: assignee === you ? m['plan.done-with-others']() : m['plan.mark-done'](),
              label: m['plan.mark-done-label']({ task: row.task, day }),
              choices: people.map((person) => ({
                ...person,
                checked: person.id === (assignee ?? you),
              })),
              problem: choiceProblem(row.occurrence),
            }
          : null,
      };
    };
    return {
      id,
      start: week.start,
      heading: heading(calendarDays(week.start, week.last, locale)),
      // A draft of a week begun already, such as the one a household started in, has no time to
      // be published at: a head publishes it (ADR-0007 §3).
      draft: draft
        ? week.publishAt === null
          ? m['plan.draft-heads-publish']()
          : m['plan.draft']({ when: dayAndTime(week.publishAt, timeZone, locale) })
        : null,
      publish: draft && mayPublish ? { week: week.start, version: week.version } : null,
      members: week.members.map((member) => {
        const yours = member.id === you;
        return {
          id: member.id,
          heading: yours ? m['household.you']({ name: member.name }) : member.name,
          items: member.assignments.map((a) => ({
            ...item(a, member.id),
            points: a.cost === null ? null : m['plan.points']({ count: Math.round(a.cost) }),
            why: yours ? reasons[a.reason].you() : reasons[a.reason].other(member.name),
          })),
        };
      }),
      unassigned: week.unassigned.map((u) => ({
        ...item(u, null),
        points: null,
        why: causes[u.cause](),
      })),
    };
  };

  const weeks = $derived.by(() => {
    const { thisWeek, nextWeek } = data();
    return [
      thisWeek &&
        shown(
          thisWeek,
          'this-week',
          (days) => m['plan.this-week']({ days }),
          m['plan.any-day-this-week'],
        ),
      nextWeek &&
        shown(
          nextWeek,
          'next-week',
          (days) => m['plan.next-week']({ days }),
          m['plan.any-day-next-week'],
        ),
    ].filter((week) => week !== null);
  });

  /** The task the last form sent was about, with the week it is in. */
  const lastItem = $derived.by(() => {
    const occurrence = outcome()?.occurrence;
    for (const week of weeks) {
      const items = [...week.members.flatMap((member) => member.items), ...week.unassigned];
      const found = items.find((item) => item.occurrence === occurrence);
      if (found) return { week: week.start, item: found };
    }
    return null;
  });

  return {
    get weeks() {
      return weeks;
    },
    /** What marking a task of `week` done, or undoing it, did, in words (UI-12). */
    statusOf: (week: string) => {
      const last = outcome();
      if (lastItem?.week !== week || !last || last.problem) return '';
      const { task } = lastItem.item;
      if (last.completed) return m['plan.completed']({ task });
      if (last.undone) return m['plan.reopened']({ task });
      return '';
    },
    /** Why marking a task of `week` done, or undoing it, didn't go through, in words. */
    problemOf: (week: string) => {
      const last = outcome();
      if (lastItem?.week !== week || !last?.problem) return null;
      const { task, key } = lastItem.item;
      switch (last.problem) {
        case 'already-done':
          return {
            heading: m['plan.complete-failed'](),
            message: m['plan.already-done']({ task, doers: names(last.doers ?? []) }),
            fields: [],
          };
        case 'no-doers':
          return {
            heading: m['plan.complete-failed'](),
            message: m['plan.no-doers-summary']({ task }),
            fields: [{ id: `${key}-who`, problem: m['plan.no-doers']() }],
          };
        case 'week-over':
          return {
            heading: m['plan.undo-failed'](),
            message: m['plan.week-over']({ task }),
            fields: [],
          };
        case 'not-found':
          return {
            heading: m['plan.undo-failed'](),
            message: m['plan.undone-already']({ task }),
            fields: [],
          };
        default:
          return {
            heading: m['plan.complete-failed'](),
            message: m['plan.not-completable']({ task }),
            fields: [],
          };
      }
    },
    /**
     * Sends a task's form, then, once it went through, moves the focus to the first of `targets`,
     * by id, that replaced the control used: Undo after marking it done, Done after undoing (UI-7).
     * When it didn't go through, the summary of why takes the focus instead, and the plan shows
     * what is there now, such as who did it already (ADR-0019 §6), as it does without JavaScript.
     */
    thenFocus:
      (...targets: string[]): SubmitFunction =>
      () =>
      async ({ result, update }) => {
        await update({ refreshAll: true });
        if (result.type !== 'success') return;
        await tick();
        const target = targets.map((id) => document.getElementById(id)).find((found) => found);
        target?.focus();
      },
    /**
     * Publishes a draft, then moves the focus to `target`, its week's heading, once the button is
     * gone with the draft. When it didn't go through, the summary of why takes the focus instead.
     */
    publishThenFocus:
      (target: () => HTMLElement | undefined): SubmitFunction =>
      () =>
      async ({ result, update }) => {
        await update();
        if (result.type === 'success') target()?.focus();
      },
  };
}
