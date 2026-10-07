import type { Window } from '../schedules/occurrence';

/** An occurrence as the allocator sees it: which task, and when. */
export interface PlannedOccurrence {
  id: string;
  task: string;
  date: Temporal.PlainDate;
  window: Window;
}

/**
 * The occurrences that go to the same member because of same-person links (ADR-0001 §7,
 * clarification): each occurrence of a task with a link, then the linked task's next occurrence on
 * or after its date. `links` maps a task to the task linked to it, as "put the bin out" to "bring it
 * in". To carry links over from last week, pass the occurrences of both weeks.
 */
export function linkedPairs(
  occurrences: readonly PlannedOccurrence[],
  links: ReadonlyMap<string, string>,
): [PlannedOccurrence, PlannedOccurrence][] {
  const sorted = [...occurrences].sort(byTime);
  const pairs: [PlannedOccurrence, PlannedOccurrence][] = [];
  for (const first of sorted) {
    const linked = links.get(first.task);
    if (linked === undefined || linked === first.task) continue;
    const next = sorted.find(
      (o) => o.task === linked && Temporal.PlainDate.compare(o.date, first.date) >= 0,
    );
    if (next) pairs.push([first, next]);
  }
  return pairs;
}

/**
 * The week's allocation units (ADR-0001 §7): occurrences paired by links, directly or through others,
 * form one unit. Each unit and the list are in time order.
 */
export function allocationUnits(
  occurrences: readonly PlannedOccurrence[],
  links: ReadonlyMap<string, string>,
): PlannedOccurrence[][] {
  const root = new Map(occurrences.map((o) => [o.id, o.id]));
  const find = (id: string): string => {
    const parent = root.get(id) ?? id;
    return parent === id ? id : find(parent);
  };
  for (const [first, second] of linkedPairs(occurrences, links)) {
    const [a, b] = [find(first.id), find(second.id)];
    if (a !== b) root.set(b, a);
  }
  const units = new Map<string, PlannedOccurrence[]>();
  for (const occurrence of [...occurrences].sort(byTime)) {
    const key = find(occurrence.id);
    const unit = units.get(key);
    if (unit) unit.push(occurrence);
    else units.set(key, [occurrence]);
  }
  return [...units.values()];
}

// By date, then window start, then id, so the same occurrences always come out in the same order.
function byTime(a: PlannedOccurrence, b: PlannedOccurrence) {
  return (
    Temporal.PlainDate.compare(a.date, b.date) ||
    Temporal.ZonedDateTime.compare(a.window.start, b.window.start) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
