import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocationUnits, linkedPairs, type PlannedOccurrence } from './units';

// Invariants of same-person units over generated occurrences and links (TEST-1).

const tasks = ['a', 'b', 'c', 'd'] as const;
const start = Temporal.ZonedDateTime.from('2026-10-12T00:00[Europe/Brussels]');
const occurrences: fc.Arbitrary<PlannedOccurrence[]> = fc
  .array(fc.tuple(fc.constantFrom(...tasks), fc.integer({ min: 0, max: 20 * 24 - 1 })), {
    maxLength: 25,
  })
  .map((items) =>
    items.map(([task, hour], i) => {
      const begin = start.add({ hours: hour });
      return {
        id: `o${String(i)}`,
        task,
        date: begin.toPlainDate(),
        window: { start: begin, end: begin.add({ hours: 2 }) },
      };
    }),
  );
const links = fc
  .array(fc.tuple(fc.constantFrom(...tasks), fc.constantFrom(...tasks)), { maxLength: 4 })
  .map((pairs) => new Map<string, string>(pairs));
const unitIds = (list: readonly PlannedOccurrence[], l: ReadonlyMap<string, string>) =>
  allocationUnits(list, l).map((unit) => unit.map((o) => o.id));

describe('unit invariants (ADR-0001 §7)', () => {
  it('puts every occurrence in exactly one unit', () => {
    fc.assert(
      fc.property(occurrences, links, (list, l) => {
        const all = unitIds(list, l).flat();
        expect([...all].sort()).toEqual(list.map((o) => o.id).sort());
      }),
    );
  });

  it('keeps each linked pair together', () => {
    fc.assert(
      fc.property(occurrences, links, (list, l) => {
        const unitOf = new Map(unitIds(list, l).flatMap((ids, n) => ids.map((id) => [id, n])));
        for (const [first, second] of linkedPairs(list, l)) {
          expect(unitOf.get(first.id)).toBe(unitOf.get(second.id));
        }
      }),
    );
  });

  it('pairs with the earliest occurrence of the linked task on or after the date', () => {
    fc.assert(
      fc.property(occurrences, links, (list, l) => {
        for (const [first, second] of linkedPairs(list, l)) {
          expect(second.task).toBe(l.get(first.task));
          expect(Temporal.PlainDate.compare(second.date, first.date)).toBeGreaterThanOrEqual(0);
          const earlier = list.filter(
            (o) =>
              o.task === second.task &&
              Temporal.PlainDate.compare(o.date, first.date) >= 0 &&
              Temporal.PlainDate.compare(o.date, second.date) < 0,
          );
          expect(earlier).toEqual([]);
        }
      }),
    );
  });

  it('does not depend on the order of the input', () => {
    fc.assert(
      fc.property(
        occurrences.chain((list) =>
          fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length })),
        ),
        links,
        ([list, shuffled], l) => {
          expect(unitIds(shuffled, l)).toEqual(unitIds(list, l));
        },
      ),
    );
  });
});
