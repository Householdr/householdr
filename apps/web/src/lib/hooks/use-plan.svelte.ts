import type { SubmitFunction } from '$app/forms';
import { tick } from 'svelte';
import {
  calendarDays,
  dayAndTime,
  dayTime,
  fullDay,
  listOf,
  timeOf,
  weekDay,
  weekdayName,
} from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { PastDayWords } from '#lib/past-day.js';
import type { PastDay, Reason, UnassignedCause } from '@householdr/application';

/** A member a completion names: no name for a former member (ADR-0012 §6). */
interface Named {
  id: string;
  name: string | null;
}

/** A task of a week's plan, as page data. */
interface ItemData {
  id: string;
  occurrence: string;
  task: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** For a task at set times: its window, as epoch milliseconds, which everyone sees. */
  window: { start: number; end: number } | null;
  /** Whether the reader may mark it done now. */
  completable: boolean;
  completion: {
    id: string;
    /** `YYYY-MM-DD`. */
    day: string;
    /** How long ago that day was. */
    when: PastDay;
    /** Epoch milliseconds, for those it credits, and for everyone at set times (ADR-0018 §3). */
    at: number | null;
    doers: Named[];
    loggedBy: Named;
    mayUndo: boolean;
  } | null;
  /** What moving it sends, for a head who may (ADR-0006 §2–§3). */
  move: { version: number } | null;
  /** Whether the reader may offer it in a swap (ADR-0002 §5). */
  swappable: boolean;
}

/** A swap waiting for an answer, as page data (ADR-0002 §5). */
export interface SwapData {
  id: string;
  from: Named;
  to: Named;
  /** The assignments it moves, by id. */
  give: string;
  take: string | null;
  balances: { from: { now: number; after: number }; to: { now: number; after: number } };
  mayAnswer: boolean;
}

/** A swap as the page shows it: what is offered, what it does to both balances, and answering it. */
export interface ShownSwap {
  id: string;
  said: string;
  balances: string[];
  /** Whether the reader may accept or decline it; else it waits for the other. */
  mayAnswer: boolean;
  waiting: string | null;
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
  /** For heads, while it is a draft: who joined after it was made. */
  joinedSince: { id: string; name: string }[];
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
  /** For a task at set times: when its window opens and closes, as a weekday and a time. */
  times: { from: string; to: string } | null;
  points: string | null;
  why: string;
  /** Who did it and when, who logged it if not only they did, and undoing it, if the reader may. */
  done: {
    /** What it says, around the day, which shows the exact day in a tooltip (ADR-0008 §6). */
    said: { before: string; day: PastDayWords; after: string };
    loggedBy: string | null;
    undo: { completion: string; label: string } | null;
  } | null;
  /**
   * On the reader's own task, while it can be marked done or once it is: the box that says whether
   * it is, which ticks it with one tap or unticks it to undo it, when the reader may (ADR-0006 §4).
   */
  check: {
    checked: boolean;
    /** Its name, which says the task and its day whether it is ticked or not. */
    label: string;
    /** What ticking or unticking it sends; none when the reader may not undo it. */
    action: 'complete' | 'undo' | null;
    /** The completion unticking it undoes. */
    completion: string | null;
  } | null;
  /**
   * While it can be marked done: the choice of who did it, starting with its assignee, or the
   * reader for a task nobody has.
   */
  complete: {
    summary: string;
    label: string;
    choices: Choice[];
    /** Why the choice wasn't accepted, which opens it. */
    problem: string | null;
  } | null;
  /**
   * For a head, while it can be moved: the choice of whom to give it to instead, starting with
   * whoever has it, and the version it is moved from (ADR-0006 §2–§3, ADR-0019 §5).
   */
  move: { label: string; version: number; choices: Choice[] } | null;
  /**
   * While the reader may offer it in a swap: whose it is, and the choice of to whom and for what,
   * one of their open tasks in the same plan or nothing (ADR-0002 §5).
   */
  swap: { from: string; label: string; choices: { value: string; label: string }[] } | null;
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
  /**
   * For heads, while it is a draft: what drafting it again does, or who joined after it was made
   * and gets nothing from it, in words, and what drafting it again sends (ADR-0002 §1,
   * clarification; ADR-0006 §2).
   */
  redraft: { said: string; week: string } | null;
  members: { id: string; heading: string; items: ShownItem[] }[];
  unassigned: ShownItem[];
}

/** What the last form sent about a task came to, as the plan's action answers. */
export interface ItemOutcome {
  occurrence?: string;
  completed?: boolean;
  undone?: boolean;
  moved?: boolean;
  proposed?: boolean;
  answered?: 'accepted' | 'declined';
  swapProblem?: string;
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
  're-allocated: member unavailable': {
    other: (name) => m['plan.reason.reallocated']({ name }),
    you: m['plan.reason.reallocated-you'],
  },
  swapped: {
    other: (name) => m['plan.reason.swapped']({ name }),
    you: m['plan.reason.swapped-you'],
  },
};

/** Stands for the day in a sentence, to split it there: a character no message has. */
const mark = '\uE000';

/** Why nobody has an occurrence, for heads (ADR-0001 §7, clarification). */
const causes: Record<UnassignedCause, () => string> = {
  'nobody eligible': m['plan.cause.nobody-eligible'],
  'bound member not eligible': m['plan.cause.bound-member-not-eligible'],
  'linked member not eligible': m['plan.cause.linked-member-not-eligible'],
};

/**
 * What the plan's page needs besides its data (CODE-9): this week's and next week's plans in the
 * reader's words, with days in `locale`, the page's language with the account's conventions
 * (ADR-0008 §6), and times in the household's time zone (UI-22), and the focus kept once publishing
 * takes its button with it (UI-7).
 */
export function usePlan(
  data: () => {
    timeZone: string;
    locale: string;
    you: string;
    mayPublish: boolean;
    thisWeek: WeekData | null;
    nextWeek: WeekData | null;
    swaps: SwapData[];
  },
  outcome: () => ItemOutcome | null | undefined,
) {
  /** A member by name, the reader as “you” (UI-21). */
  const nameOf = ({ id, name }: Named) =>
    id === data().you ? m['plan.you']() : (name ?? m['plan.a-former-member']());
  /** Members by name. */
  const names = (list: readonly Named[]) => listOf(list.map(nameOf), data().locale);

  /** Who did it and when: the time for those it credits only (ADR-0018 §3). */
  const doneOf = (done: NonNullable<ItemData['completion']>, task: string, day: string) => {
    const { timeZone, locale } = data();
    const doers = names(done.doers);
    const alone = done.doers.length === 1 && done.doers[0]?.id === done.loggedBy.id;
    // Today, yesterday, or which day of this plan week (ADR-0008 §6, clarification).
    const when =
      done.when === 'today'
        ? m['plan.done-today']()
        : done.when === 'yesterday'
          ? m['plan.done-yesterday']()
          : m['plan.done-on']({
              weekday: weekdayName(Temporal.PlainDate.from(done.day).dayOfWeek, locale),
            });
    // The sentence around the day, so the day alone carries the tooltip.
    const sentence =
      done.at === null
        ? m['plan.done']({ day: mark, doers })
        : m['plan.done-at']({ day: mark, time: timeOf(done.at, timeZone, locale), doers });
    const [before = '', after = ''] = sentence.split(mark);
    return {
      said: {
        before,
        day: { said: when, exact: fullDay(done.day, locale), datetime: done.day },
        after,
      },
      loggedBy: alone ? null : m['plan.logged-by']({ name: nameOf(done.loggedBy) }),
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
    const { timeZone, locale, you, mayPublish } = data();
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
      const own = assignee === you;
      const label = m['plan.done-label']({ task: row.task, day });
      const check: ShownItem['check'] = !own
        ? null
        : row.completion
          ? {
              checked: true,
              label,
              action: row.completion.mayUndo ? 'undo' : null,
              completion: row.completion.id,
            }
          : row.completable
            ? { checked: false, label, action: 'complete', completion: null }
            : null;
      return {
        id: row.id,
        key: `${id}-${row.occurrence}`,
        occurrence: row.occurrence,
        task: row.task,
        date: row.date,
        day,
        anyDay: earlier,
        times: row.window && {
          from: dayTime(row.window.start, timeZone, locale),
          to: dayTime(row.window.end, timeZone, locale),
        },
        done: row.completion && doneOf(row.completion, row.task, day),
        check,
        complete: row.completable
          ? {
              summary: own ? m['plan.done-with-others']() : m['plan.mark-done'](),
              label: m['plan.mark-done-label']({ task: row.task, day }),
              choices: people.map((person) => ({
                ...person,
                checked: person.id === (assignee ?? you),
              })),
              problem: choiceProblem(row.occurrence),
            }
          : null,
        move: row.move && {
          label: m['plan.move-label']({ task: row.task, day }),
          version: row.move.version,
          choices: people.map((person) => ({ ...person, checked: person.id === assignee })),
        },
        swap:
          row.swappable && assignee !== null
            ? {
                from: assignee,
                label: m['plan.swap-label']({ task: row.task, day }),
                choices: week.members
                  .filter((member) => member.id !== assignee)
                  .flatMap((member) => {
                    const name = people.find((person) => person.id === member.id)?.name ?? '';
                    return [
                      { value: `${member.id}:`, label: m['plan.swap-hand-off']({ name }) },
                      ...member.assignments
                        .filter((a) => a.completion === null)
                        .map((a) => ({
                          value: `${member.id}:${a.id}`,
                          label: m['plan.swap-trade']({
                            name,
                            task: a.task,
                            day: a.date < week.start ? anyDay() : weekDay(a.date, locale),
                          }),
                        })),
                    ];
                  }),
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
      // Heads re-run the allocator on a draft at any time, keeping what they moved (ADR-0006 §2);
      // above all once someone joined after it was made (ADR-0002 §1, clarification).
      redraft:
        draft && mayPublish
          ? {
              said:
                week.joinedSince.length > 0
                  ? m['plan.joined-since']({
                      count: week.joinedSince.length,
                      names: listOf(
                        week.joinedSince.map(({ name }) => name),
                        locale,
                      ),
                    })
                  : m['plan.redraft-intro'](),
              week: week.start,
            }
          : null,
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

  /** Each swap waiting for an answer, in words, with the reader as "you" (UI-21). */
  const swaps = $derived.by((): ShownSwap[] => {
    const { you } = data();
    const items = weeks.flatMap((week) => [
      ...week.members.flatMap((member) => member.items),
      ...week.unassigned,
    ]);
    const what = (assignment: string) => {
      const item = items.find((i) => i.id === assignment);
      return item ? m['plan.swap-task']({ task: item.task, day: item.day }) : '';
    };
    // Someone in a swap is a member now, but a name may be gone with their profile (ADR-0012 §6).
    const nameOf = ({ name }: Named) => name ?? m['plan.a-former-member']();
    const named = (person: Named) =>
      person.id === you ? m['household.you']({ name: nameOf(person) }) : nameOf(person);
    const points = (count: number) => m['plan.points']({ count: Math.round(count) });
    return data().swaps.map((swap) => ({
      id: swap.id,
      said:
        swap.take === null
          ? m['plan.swap-offer-hand-off']({
              from: named(swap.from),
              to: named(swap.to),
              give: what(swap.give),
            })
          : m['plan.swap-offer-trade']({
              from: named(swap.from),
              to: named(swap.to),
              give: what(swap.give),
              take: what(swap.take),
            }),
      balances: [
        m['plan.swap-balance']({
          name: named(swap.from),
          now: points(swap.balances.from.now),
          after: points(swap.balances.from.after),
        }),
        m['plan.swap-balance']({
          name: named(swap.to),
          now: points(swap.balances.to.now),
          after: points(swap.balances.to.after),
        }),
      ],
      mayAnswer: swap.mayAnswer,
      waiting: swap.mayAnswer ? null : m['plan.swap-waiting']({ name: nameOf(swap.to) }),
    }));
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
    get swaps() {
      return swaps;
    },
    /** What the last answer to a swap did, or why it didn't go through, in words (UI-12). */
    swapStatus: () => {
      const last = outcome();
      if (last?.answered === 'accepted') return m['plan.swap-accepted']();
      if (last?.answered === 'declined') return m['plan.swap-declined']();
      return '';
    },
    swapProblem: () => {
      const problem = outcome()?.swapProblem;
      if (problem === 'gone') return m['plan.swap-gone']();
      if (problem === 'not-found') return m['plan.swap-answered-already']();
      return '';
    },
    /** What marking a task of `week` done, or undoing it, did, in words (UI-12). */
    statusOf: (week: string) => {
      const last = outcome();
      if (lastItem?.week !== week || !last || last.problem) return '';
      const { task } = lastItem.item;
      if (last.completed) return m['plan.completed']({ task });
      if (last.undone) return m['plan.reopened']({ task });
      if (last.moved) return m['plan.moved']({ task });
      if (last.proposed) return m['plan.swap-proposed']({ task });
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
        case 'move-conflict':
          return {
            heading: m['plan.move-failed'](),
            message: m['plan.move-changed']({ task }),
            fields: [],
          };
        case 'swap-already':
          return {
            heading: m['plan.swap-failed'](),
            message: m['plan.swap-already']({ task }),
            fields: [],
          };
        case 'swap-not-swappable':
          return {
            heading: m['plan.swap-failed'](),
            message: m['plan.swap-not-swappable']({ task }),
            fields: [],
          };
        case 'not-movable':
          return {
            heading: m['plan.move-failed'](),
            message: m['plan.not-movable']({ task }),
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
     * by id, that is there: the box itself on the reader's own task, else Undo after marking it
     * done, or the choice of who did it after undoing (UI-7).
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
