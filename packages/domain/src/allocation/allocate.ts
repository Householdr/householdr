import { planWeekStart, type HouseholdCalendar } from '../schedules/week';
import { isEligible, type Candidate, type TaskRules } from './eligibility';
import { allocationUnits, type PlannedOccurrence } from './units';

/** A task as the allocator sees it (ADR-0001 §1, §5). */
export interface AllocationTask extends TaskRules {
  id: string;
  /** In minutes. */
  duration: number;
  /** By member id, normalised around 1 (ADR-0003 §1). */
  burden: ReadonlyMap<string, number>;
  /** The task whose next occurrence goes to the same member. */
  linkedTo?: string;
}

/** A member as the allocator sees them (ADR-0001 §7). */
export interface AllocationMember extends Candidate {
  /** Ledger balance in points: positive when ahead (ADR-0002 §1). */
  balance: number;
  /** Points already assigned this week: 0 for a draft, the week's loads after publishing (ADR-0006 §3). */
  load: number;
  /** The tasks they had in last week's plan. */
  lastWeek: ReadonlySet<string>;
}

export interface AllocationInput {
  /** Any day of the plan week. */
  week: Temporal.PlainDate;
  calendar: HouseholdCalendar;
  /** The household's rebalance rate (ADR-0002 §3). */
  rebalanceRate: number;
  members: readonly AllocationMember[];
  tasks: readonly AllocationTask[];
  occurrences: readonly PlannedOccurrence[];
  /** Member ids by occurrence id, as a head pre-assigned them in the draft (ADR-0006 §2). */
  preAssigned: ReadonlyMap<string, string>;
  /** Member ids by occurrence id, for links from an occurrence assigned last week. */
  carried: ReadonlyMap<string, string>;
}

/** Why an occurrence went where it did (ADR-0001 §7, step 7). */
export type Reason =
  | 'bound'
  | 'assigned by head'
  | 'linked'
  | 'only eligible member'
  | 'lowest relative load'
  | 'catching up';

export interface Assignment {
  occurrence: string;
  member: string;
  /** The points charged: duration × the member's burden (ADR-0001 §5). */
  cost: number;
  reason: Reason;
}

/** Why an occurrence stayed unassigned, for the heads (ADR-0001 §7, clarification). */
export type UnassignedCause =
  'nobody eligible' | 'bound member not eligible' | 'linked member not eligible';

export interface Allocation {
  /** Unit by unit, in time order. */
  assignments: Assignment[];
  unassigned: { occurrence: string; cause: UnassignedCause }[];
}

const rotationPenalty = 0.1;

/**
 * Who does what this week (ADR-0001 §7 with its clarification): head pre-assignments and links
 * from last week first, then bound units, then the rest, most constrained and longest first, each to
 * the eligible member with the lowest relative load.
 */
export function allocate(input: AllocationInput): Allocation {
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const task = (id: string) => {
    const found = tasks.get(id);
    if (!found) throw new RangeError(`Unknown task ${id}`);
    return found;
  };
  const cost = (part: PlannedOccurrence, member: AllocationMember) => {
    const burden = task(part.task).burden.get(member.id);
    if (burden === undefined) throw new RangeError(`No burden for ${member.id} on ${part.task}`);
    return task(part.task).duration * burden;
  };
  const eligible = (member: AllocationMember, unit: readonly PlannedOccurrence[]) =>
    unit.every((part) =>
      isEligible(member, task(part.task), part.window, input.week, input.calendar),
    );

  const links = new Map(input.tasks.flatMap((t) => (t.linkedTo ? [[t.id, t.linkedTo]] : [])));
  const units = allocationUnits(input.occurrences, links);
  const order = new Map(units.flat().map((part, index) => [part.id, index]));
  const load = new Map(input.members.map((m) => [m.id, m.load]));
  const result: Allocation = { assignments: [], unassigned: [] };

  const give = (unit: readonly PlannedOccurrence[], member: AllocationMember, reason: Reason) => {
    for (const part of unit) {
      const charged = cost(part, member);
      load.set(member.id, (load.get(member.id) ?? 0) + charged);
      result.assignments.push({ occurrence: part.id, member: member.id, cost: charged, reason });
    }
  };
  const leave = (unit: readonly PlannedOccurrence[], cause: UnassignedCause) => {
    for (const part of unit) result.unassigned.push({ occurrence: part.id, cause });
  };
  const member = (id: string | undefined) => input.members.find((m) => m.id === id);

  // Step 3 and the clarification: what heads placed, and links carried over from last week.
  const open: PlannedOccurrence[][] = [];
  for (const unit of units) {
    const byHead = unit.find((part) => input.preAssigned.has(part.id));
    const carried = unit.find((part) => input.carried.has(part.id));
    if (byHead) {
      const anchor = input.preAssigned.get(byHead.id);
      for (const part of unit) {
        const chosen = member(input.preAssigned.get(part.id) ?? anchor);
        if (!chosen) throw new RangeError(`Unknown member for ${part.id}`);
        give([part], chosen, 'assigned by head');
      }
    } else if (carried) {
      const previous = member(input.carried.get(carried.id));
      if (previous && eligible(previous, unit)) give(unit, previous, 'linked');
      else leave(unit, 'linked member not eligible');
    } else {
      open.push(unit);
    }
  }

  // Steps 3 to 6: bound units first, then the rest, each sorted by fewest candidates, then longest.
  // For each part with bound members, who they are: the unit can only go to someone in all of them.
  const boundTo = (unit: readonly PlannedOccurrence[]) =>
    unit.flatMap((part) => {
      const members = [...task(part.task).constraints].filter(([, c]) => c === 'bound');
      return members.length ? [new Set(members.map(([id]) => id))] : [];
    });
  const isBound = (unit: readonly PlannedOccurrence[]) => boundTo(unit).length > 0;
  const candidates = (unit: readonly PlannedOccurrence[]) =>
    input.members.filter((m) => eligible(m, unit) && boundTo(unit).every((ids) => ids.has(m.id)));
  const duration = (unit: readonly PlannedOccurrence[]) =>
    unit.reduce((sum, part) => sum + task(part.task).duration, 0);
  const sorted = (list: PlannedOccurrence[][]) =>
    list
      .map((unit) => ({ unit, candidates: candidates(unit), duration: duration(unit) }))
      .sort(
        (a, b) =>
          a.candidates.length - b.candidates.length ||
          b.duration - a.duration ||
          (order.get(a.unit[0]?.id ?? '') ?? 0) - (order.get(b.unit[0]?.id ?? '') ?? 0),
      );

  const seed = planWeekStart(input.week, input.calendar.weekStartDay).toString();
  const score = (unit: readonly PlannedOccurrence[], m: AllocationMember, catchUp: boolean) => {
    let numerator = load.get(m.id) ?? 0;
    for (const part of unit) {
      numerator += cost(part, m) * (m.lastWeek.has(part.task) ? 1 + rotationPenalty : 1);
    }
    if (catchUp) numerator += input.rebalanceRate * m.balance;
    return numerator / m.fairFraction;
  };
  const best = (
    unit: readonly PlannedOccurrence[],
    among: AllocationMember[],
    catchUp: boolean,
  ) => {
    const tie = (m: AllocationMember) => hash(`${seed}|${unit[0]?.task ?? ''}|${m.id}`);
    return among.reduce((winner, m) => {
      const difference = score(unit, m, catchUp) - score(unit, winner, catchUp);
      return difference < 0 || (difference === 0 && tie(m) < tie(winner)) ? m : winner;
    });
  };

  const queue = [...sorted(open.filter(isBound)), ...sorted(open.filter((u) => !isBound(u)))];
  for (const { unit, candidates: among } of queue) {
    const [first] = among;
    if (!first) {
      leave(unit, isBound(unit) ? 'bound member not eligible' : 'nobody eligible');
    } else if (isBound(unit)) {
      give(unit, best(unit, among, true), 'bound');
    } else if (among.length === 1) {
      give(unit, first, 'only eligible member');
    } else {
      const winner = best(unit, among, true);
      const changed = best(unit, among, false) !== winner;
      give(unit, winner, changed ? 'catching up' : 'lowest relative load');
    }
  }

  const position = (id: string) => order.get(id) ?? 0;
  result.assignments.sort((a, b) => position(a.occurrence) - position(b.occurrence));
  result.unassigned.sort((a, b) => position(a.occurrence) - position(b.occurrence));
  return result;
}

// FNV-1a, so ties go the same way every time for the same week, task and member (step 6).
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value = Math.imul(value ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return value;
}
