import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { occurrences, type Timing } from '../schedules/occurrence';
import type { AwayPeriod } from '../schedules/since-last-done';
import type { HouseholdCalendar } from '../schedules/week';
import { weekOccurrences, type PlanTask } from './week-occurrences';

// Invariants of plan generation over generated households, run week after week (TEST-1). A run
// expands schedules over a year for every week, so the runs are fewer and the timeouts longer.

const calendar: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const first = Temporal.PlainDate.from('2026-10-05');
const weeks = 12;
const last = first.add({ weeks });
const evening: Timing = {
  kind: 'fixed',
  from: { dayOffset: 0, time: Temporal.PlainTime.from('18:00') },
  to: { dayOffset: 0, time: Temporal.PlainTime.from('22:00') },
};
const schedule = (rrule: string) => ({
  rules: [{ rrule, start: Temporal.PlainDate.from('2026-01-01') }],
  extraDates: [],
  exceptionDates: [],
});

const household = fc.record({
  tasks: fc
    .tuple(
      fc.integer({ min: 10, max: 40 }),
      fc.array(fc.constantFrom('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'), { maxLength: 2 }),
      fc.array(
        fc.record({
          day: fc.integer({ min: 1, max: 28 }),
          duration: fc.integer({ min: 15, max: 120 }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    )
    .map(([dishes, weekly, floating]): PlanTask[] => [
      {
        id: 'dishes',
        duration: dishes,
        onMiss: 'lapse',
        recurrence: { kind: 'schedule', schedule: schedule('FREQ=DAILY'), timing: evening },
      },
      ...weekly.map((day, i): PlanTask => ({
        id: `weekly-${String(i)}`,
        duration: 30,
        onMiss: 'roll over',
        recurrence: {
          kind: 'schedule',
          schedule: schedule(`FREQ=WEEKLY;BYDAY=${day}`),
          timing: { kind: 'flexible' },
        },
      })),
      ...floating.map((f, i): PlanTask => ({
        id: `floating-${String(i)}`,
        duration: f.duration,
        onMiss: 'roll over',
        recurrence: {
          kind: 'schedule',
          schedule: schedule(`FREQ=MONTHLY;BYMONTHDAY=${String(f.day)}`),
          timing: { kind: 'floating' },
        },
      })),
    ]),
  away: fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: weeks * 7 }), fc.integer({ min: 0, max: 20 }))
      .map(([start, length]): AwayPeriod => {
        const from = first.add({ days: start });
        return { from, to: from.add({ days: length }) };
      }),
    { maxLength: 2 },
  ),
});

const isAway = (away: readonly AwayPeriod[], day: Temporal.PlainDate) =>
  away.some(
    (p) =>
      Temporal.PlainDate.compare(p.from, day) <= 0 && Temporal.PlainDate.compare(day, p.to) <= 0,
  );
const days = (from: Temporal.PlainDate, count: number) =>
  Array.from({ length: count }, (_, i) => from.add({ days: i }));

describe('plan generation invariants (ADR-0001 §7, ADR-0004 §4, ADR-0005 §5)', () => {
  it('plans every week at home, never inside an away period, and places each floating occurrence once', () => {
    fc.assert(
      fc.property(household, ({ tasks, away }) => {
        const placedIn = new Map<string, Temporal.PlainDate>();
        const plannedWeeks: Temporal.PlainDate[] = [];
        for (let w = 0; w < weeks; w++) {
          const start = first.add({ weeks: w });
          const result = weekOccurrences({
            week: start,
            calendar,
            tasks,
            open: [],
            placedEarlier: new Set(placedIn.keys()),
            away,
          });
          const wholeWeekAway = days(start, 7).every((d) => isAway(away, d));
          expect(result.planned).toBe(!wholeWeekAway);
          if (result.planned) plannedWeeks.push(start);
          const ids = result.occurrences.map((o) => o.id);
          expect(new Set(ids).size).toBe(ids.length);
          for (const o of result.occurrences) {
            const span =
              o.window.start
                .toPlainDate()
                .until(o.window.end.subtract({ nanoseconds: 1 }).toPlainDate()).days + 1;
            expect(days(o.window.start.toPlainDate(), span).every((d) => isAway(away, d))).toBe(
              false,
            );
            if (o.task.startsWith('floating')) {
              expect(placedIn.has(o.id)).toBe(false);
              placedIn.set(o.id, start);
            }
          }
        }
        // Every floating occurrence whose window lies in the simulated weeks, and has a planned
        // week, is placed exactly once, in a week of its window.
        for (const task of tasks) {
          const r = task.recurrence;
          if (r.kind !== 'schedule' || r.timing.kind !== 'floating') continue;
          for (const o of occurrences(
            r.schedule,
            r.timing,
            first.subtract({ years: 1 }),
            last,
            calendar,
          )) {
            const id = `${task.id}@${o.date.toString()}`;
            const from = o.window.start.toPlainDate();
            const until = o.window.end.toPlainDate();
            const inWindow = (d: Temporal.PlainDate) =>
              Temporal.PlainDate.compare(from, d) <= 0 && Temporal.PlainDate.compare(d, until) < 0;
            const placed = placedIn.get(id);
            if (placed) expect(inWindow(placed)).toBe(true);
            const simulated =
              Temporal.PlainDate.compare(first, from) <= 0 &&
              Temporal.PlainDate.compare(until, last) <= 0;
            if (simulated && plannedWeeks.some(inWindow)) expect(placed).toBeDefined();
          }
        }
      }),
      { numRuns: 20 },
    );
  }, 60_000);

  it('does not depend on the order of the tasks', () => {
    fc.assert(
      fc.property(
        household.chain((h) =>
          fc.tuple(fc.constant(h), fc.shuffledSubarray(h.tasks, { minLength: h.tasks.length })),
        ),
        fc.integer({ min: 0, max: weeks - 1 }),
        ([{ tasks, away }, shuffled], w) => {
          const input = {
            week: first.add({ weeks: w }),
            calendar,
            open: [],
            placedEarlier: new Set<string>(),
            away,
          };
          expect(weekOccurrences({ ...input, tasks: shuffled })).toEqual(
            weekOccurrences({ ...input, tasks }),
          );
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);
});
