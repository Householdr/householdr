import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dueDate,
  dueness,
  spreadFirstDueDates,
  type AwayPeriod,
  type SinceLastDone,
} from './since-last-done';

// Invariants of the "since last done" clock over generated completions and away periods (TEST-1).

const origin = Temporal.PlainDate.from('2026-01-01');
const day = fc.integer({ min: 0, max: 400 }).map((n) => origin.add({ days: n }));
const period: fc.Arbitrary<AwayPeriod> = fc
  .tuple(day, fc.integer({ min: 0, max: 30 }))
  .map(([from, length]) => ({ from, to: from.add({ days: length }) }));
const periods = fc.array(period, { maxLength: 4 });
const daysTask: fc.Arbitrary<SinceLastDone> = fc
  .integer({ min: 1, max: 120 })
  .map((count) => ({ every: { count, unit: 'days' }, start: origin }));
const anyTask: fc.Arbitrary<SinceLastDone> = fc
  .record({
    count: fc.integer({ min: 1, max: 12 }),
    unit: fc.constantFrom('days', 'weeks', 'months'),
  })
  .map((every) => ({ every, start: origin }));

const isAway = (d: Temporal.PlainDate, list: readonly AwayPeriod[]) =>
  list.some(
    (p) => Temporal.PlainDate.compare(d, p.from) >= 0 && Temporal.PlainDate.compare(d, p.to) <= 0,
  );

describe('since last done invariants (ADR-0004 §8, ADR-0005 §5)', () => {
  it('counts exactly the interval in days at home, and is due on a day at home', () => {
    fc.assert(
      fc.property(daysTask, day, periods, (task, lastDone, away) => {
        const due = dueDate(task, lastDone, away);
        let homeDays = 0;
        for (
          let d = lastDone.add({ days: 1 });
          Temporal.PlainDate.compare(d, due) <= 0;
          d = d.add({ days: 1 })
        ) {
          if (!isAway(d, away)) homeDays += 1;
        }
        expect(homeDays).toBe(task.every.count);
        expect(isAway(due, away)).toBe(false);
      }),
    );
  });

  it('is never earlier for being away, and unchanged without away periods', () => {
    fc.assert(
      fc.property(anyTask, day, periods, (task, lastDone, away) => {
        const without = dueDate(task, lastDone, []);
        expect(
          Temporal.PlainDate.compare(dueDate(task, lastDone, away), without),
        ).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('only moves later when another away period is added', () => {
    fc.assert(
      fc.property(anyTask, day, periods, period, (task, lastDone, away, extra) => {
        const before = dueDate(task, lastDone, away);
        const after = dueDate(task, lastDone, [...away, extra]);
        expect(Temporal.PlainDate.compare(after, before)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('fills the bar from 0 to 1 and never beyond', () => {
    fc.assert(
      fc.property(anyTask, day, periods, day, (task, lastDone, away, today) => {
        const { progress } = dueness(task, lastDone, away, today);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('spreading first due dates (ADR-0007 §6)', () => {
  const tasks = fc.uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      every: fc.record({
        count: fc.integer({ min: 1, max: 12 }),
        unit: fc.constantFrom('days', 'weeks', 'months'),
      }),
    }),
    { selector: (task) => task.id, maxLength: 12 },
  );

  it('gives every task one date, within its interval from the start', () => {
    fc.assert(
      fc.property(tasks, day, (list, from) => {
        const spread = spreadFirstDueDates(list, from);
        expect(spread.size).toBe(list.length);
        for (const task of list) {
          const first = spread.get(task.id);
          expect(first).toBeDefined();
          if (!first) return;
          const interval = dueDate({ every: task.every, start: from }, from, []);
          expect(Temporal.PlainDate.compare(first, from)).toBeGreaterThanOrEqual(0);
          expect(Temporal.PlainDate.compare(first, interval)).toBeLessThan(0);
        }
      }),
    );
  });

  it('does not depend on the order of the tasks', () => {
    fc.assert(
      fc.property(tasks, day, (list, from) => {
        const forward = [...spreadFirstDueDates(list, from)].map(
          ([id, d]) => `${id}${d.toString()}`,
        );
        const backward = [...spreadFirstDueDates([...list].reverse(), from)].map(
          ([id, d]) => `${id}${d.toString()}`,
        );
        expect(backward.sort()).toEqual(forward.sort());
      }),
    );
  });

  it('gives tasks with the same interval different days, when it has enough of them', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 60 }),
        day,
        (n, extra, from) => {
          const every = { count: n + extra, unit: 'days' } as const;
          const list = Array.from({ length: n }, (_, i) => ({ id: `task-${String(i)}`, every }));
          const days = [...spreadFirstDueDates(list, from).values()].map((d) => d.toString());
          expect(new Set(days).size).toBe(n);
        },
      ),
    );
  });
});
