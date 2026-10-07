/** Points charged to or credited to one member (ADR-0001 §5). */
export interface Points {
  member: string;
  points: number;
}

/** A task's duration and burdens as they were when the week's plan was generated (ADR-0003 §4). */
export interface CostedTask {
  /** In minutes. */
  duration: number;
  /** By member id. */
  burden: ReadonlyMap<string, number>;
}

/**
 * What a completion credits (ADR-0002 §1): each member who did it at their own cost, also when
 * several did it together.
 */
export function completionCredits(task: CostedTask, doers: readonly string[]): Points[] {
  return [...new Set(doers)].map((member) => {
    const burden = task.burden.get(member);
    if (burden === undefined) throw new RangeError(`No burden for ${member}`);
    return { member, points: task.duration * burden };
  });
}

/** One member's result for a plan week (ADR-0002 §1). */
export interface WeekSettlement {
  member: string;
  owed: number;
  done: number;
  /** What the balance changes by: done − owed. */
  change: number;
}

/**
 * Settles a plan week (ADR-0002 §1). Each member owes their fair fraction, as it ended up, of
 * everything allocated, each assignment at its assignee's cost, and is credited everything they
 * completed. Members are those in `fairFractions`, in that order.
 */
export function settleWeek(
  fairFractions: ReadonlyMap<string, number>,
  allocated: readonly Points[],
  done: readonly Points[],
): WeekSettlement[] {
  for (const { member } of [...allocated, ...done]) {
    if (!fairFractions.has(member)) throw new RangeError(`${member} is not settled this week`);
  }
  const total = allocated.reduce((sum, a) => sum + a.points, 0);
  return [...fairFractions].map(([member, fairFraction]) => {
    const owed = fairFraction * total;
    const credited = done.filter((d) => d.member === member).reduce((sum, d) => sum + d.points, 0);
    return { member, owed, done: credited, change: credited - owed };
  });
}

/** The rebalance rate presets a head chooses from; "normal" is the default (ADR-0002 §3). */
export const rebalanceRates = { fast: 0.5, normal: 0.25, slow: 0.1 } as const;

export type RebalancePreset = keyof typeof rebalanceRates;
