import type { SubmitFunction } from '$app/forms';
import { calendarDays, dayAndTime, weekDay } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { Reason, UnassignedCause } from '@householdr/application';

/** A task of a week's plan, as page data. */
interface ItemData {
  id: string;
  task: string;
  /** `YYYY-MM-DD`. */
  date: string;
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

/** A task as the plan shows it: its day in words, its points for the reader, and why. */
export interface ShownItem {
  id: string;
  task: string;
  date: string;
  day: string;
  /** Whether `day` says "any day" of the week rather than naming one. */
  anyDay: boolean;
  points: string | null;
  why: string;
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
) {
  const locale = getLocale();

  const shown = (
    week: WeekData,
    id: string,
    heading: (days: string) => string,
    anyDay: () => string,
  ): ShownWeek => {
    const { timeZone, you, mayPublish } = data();
    const draft = week.status === 'draft';
    // A task from an earlier week, carried over or floating on, can be done any day of this one:
    // its own date, in a week gone by, would only confuse (ADR-0002 §2, ADR-0004 §4).
    const item = ({ id, task, date }: ItemData) => {
      const earlier = date < week.start;
      return { id, task, date, anyDay: earlier, day: earlier ? anyDay() : weekDay(date, locale) };
    };
    return {
      id,
      start: week.start,
      heading: heading(calendarDays(week.start, week.last, locale)),
      draft:
        draft && week.publishAt !== null
          ? m['plan.draft']({ when: dayAndTime(week.publishAt, timeZone, locale) })
          : null,
      publish: draft && mayPublish ? { week: week.start, version: week.version } : null,
      members: week.members.map((member) => {
        const yours = member.id === you;
        return {
          id: member.id,
          heading: yours ? m['household.you']({ name: member.name }) : member.name,
          items: member.assignments.map((a) => ({
            ...item(a),
            points: a.cost === null ? null : m['plan.points']({ count: Math.round(a.cost) }),
            why: yours ? reasons[a.reason].you() : reasons[a.reason].other(member.name),
          })),
        };
      }),
      unassigned: week.unassigned.map((u) => ({
        ...item(u),
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

  return {
    get weeks() {
      return weeks;
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
