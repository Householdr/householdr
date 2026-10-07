import { describe, expect, it } from 'vitest';
import { allocationUnits, linkedPairs, type PlannedOccurrence } from './units';

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
const occurrence = (id: string, task: string, start: string, hours = 1): PlannedOccurrence => {
  const begin = at(start);
  return {
    id,
    task,
    date: begin.toPlainDate(),
    window: { start: begin, end: begin.add({ hours }) },
  };
};
const ids = (units: PlannedOccurrence[][]) => units.map((unit) => unit.map((o) => o.id));
const bins = new Map([['out', 'in']]);

describe('linkedPairs (ADR-0001 §7, clarification)', () => {
  it('pairs each occurrence with the linked task’s next one', () => {
    const week = [
      occurrence('out-1', 'out', '2026-10-12T18:00', 13),
      occurrence('in-1', 'in', '2026-10-13T08:00', 14),
      occurrence('out-2', 'out', '2026-10-19T18:00', 13),
      occurrence('in-2', 'in', '2026-10-20T08:00', 14),
    ];
    expect(linkedPairs(week, bins).map(([a, b]) => [a.id, b.id])).toEqual([
      ['out-1', 'in-1'],
      ['out-2', 'in-2'],
    ]);
  });

  it('pairs with an occurrence later on the same day', () => {
    const sameDay = [
      occurrence('in', 'in', '2026-10-13T19:00'),
      occurrence('out', 'out', '2026-10-13T07:00'),
    ];
    expect(linkedPairs(sameDay, bins).map(([a, b]) => [a.id, b.id])).toEqual([['out', 'in']]);
  });

  it('carries a link into next week when given both weeks', () => {
    const lastSunday = occurrence('out', 'out', '2026-10-11T18:00', 13);
    const monday = occurrence('in', 'in', '2026-10-12T08:00', 14);
    expect(linkedPairs([monday, lastSunday], bins).map(([a, b]) => [a.id, b.id])).toEqual([
      ['out', 'in'],
    ]);
  });

  it('pairs nothing when the linked task has no later occurrence', () => {
    const early = occurrence('in', 'in', '2026-10-12T08:00');
    const late = occurrence('out', 'out', '2026-10-13T18:00');
    expect(linkedPairs([early, late], bins)).toEqual([]);
  });

  it('ignores a task linked to itself', () => {
    const daily = [
      occurrence('a', 'x', '2026-10-12T08:00'),
      occurrence('b', 'x', '2026-10-13T08:00'),
    ];
    expect(linkedPairs(daily, new Map([['x', 'x']]))).toEqual([]);
  });
});

describe('allocationUnits (ADR-0001 §7)', () => {
  it('keeps unlinked occurrences apart, in time order', () => {
    const week = [
      occurrence('dishes-2', 'dishes', '2026-10-13T19:00'),
      occurrence('dishes-1', 'dishes', '2026-10-12T19:00'),
    ];
    expect(ids(allocationUnits(week, new Map()))).toEqual([['dishes-1'], ['dishes-2']]);
  });

  it('puts the bin out and brings it in as one unit', () => {
    const week = [
      occurrence('in', 'in', '2026-10-13T08:00', 14),
      occurrence('dishes', 'dishes', '2026-10-12T19:00'),
      occurrence('out', 'out', '2026-10-12T18:00', 13),
    ];
    expect(ids(allocationUnits(week, bins))).toEqual([['out', 'in'], ['dishes']]);
  });

  it('joins every occurrence that pairs with the same one', () => {
    // A daily task linked to a weekly one: Monday to Wednesday go with Wednesday's, Thursday has none.
    const week = [
      occurrence('mon', 'daily', '2026-10-12T08:00'),
      occurrence('tue', 'daily', '2026-10-13T08:00'),
      occurrence('wed', 'daily', '2026-10-14T08:00'),
      occurrence('thu', 'daily', '2026-10-15T08:00'),
      occurrence('weekly', 'weekly', '2026-10-14T18:00'),
    ];
    expect(ids(allocationUnits(week, new Map([['daily', 'weekly']])))).toEqual([
      ['mon', 'tue', 'wed', 'weekly'],
      ['thu'],
    ]);
  });

  it('follows a chain of links', () => {
    const week = [
      occurrence('c', 'sort', '2026-10-14T08:00'),
      occurrence('a', 'collect', '2026-10-12T08:00'),
      occurrence('b', 'carry', '2026-10-13T08:00'),
    ];
    const chain = new Map([
      ['collect', 'carry'],
      ['carry', 'sort'],
    ]);
    expect(ids(allocationUnits(week, chain))).toEqual([['a', 'b', 'c']]);
  });
});
