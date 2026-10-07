import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import { allocate, type AllocationInput, type AllocationTask } from './allocate';
import { isEligible, type Constraint } from './eligibility';
import { allocationUnits } from './units';

// Invariants of the allocator over generated households and weeks (TEST-1).

const calendar: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };
const monday = Temporal.PlainDate.from('2026-10-12');
const memberIds = ['m0', 'm1', 'm2', 'm3'];
const taskIds = ['t0', 't1', 't2', 't3'];

const household = (options: { constrained: boolean }): fc.Arbitrary<AllocationInput> =>
  fc
    .record({
      size: fc.integer({ min: 1, max: 4 }),
      members: fc.array(
        fc.record({
          fairFraction: options.constrained ? fc.constantFrom(0, 0.25, 0.5, 1) : fc.constant(0.5),
          balance: options.constrained ? fc.integer({ min: -60, max: 60 }) : fc.constant(0),
          away: options.constrained
            ? fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined })
            : fc.constant(undefined),
          lastWeek: options.constrained ? fc.subarray(taskIds) : fc.constant([]),
        }),
        { minLength: 4, maxLength: 4 },
      ),
      tasks: fc.array(
        fc.record({
          duration: fc.integer({ min: 5, max: 120 }),
          burden: fc.array(
            options.constrained
              ? fc.integer({ min: 5, max: 20 }).map((n) => n / 10)
              : fc.constant(1),
            { minLength: 4, maxLength: 4 },
          ),
          constraints: fc.array(
            options.constrained
              ? fc.constantFrom<Constraint | undefined>(undefined, undefined, 'bound', 'excluded')
              : fc.constant(undefined),
            { minLength: 4, maxLength: 4 },
          ),
          linkedTo: fc.option(fc.constantFrom(...taskIds), { nil: undefined }),
        }),
        { minLength: 4, maxLength: 4 },
      ),
      occurrences: fc.array(
        fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 7 * 24 - 2 })),
        { maxLength: 14 },
      ),
    })
    .map(({ size, members, tasks, occurrences }) => {
      const ids = memberIds.slice(0, size);
      return {
        week: monday,
        calendar,
        rebalanceRate: 0.25,
        members: members.slice(0, size).map((m, i) => ({
          id: ids[i] ?? '',
          fairFraction: m.fairFraction,
          availability: {
            absences:
              m.away === undefined
                ? []
                : [{ from: monday.add({ days: m.away }), to: monday.add({ days: m.away }) }],
            unavailable: [],
          },
          balance: m.balance,
          load: 0,
          lastWeek: new Set(m.lastWeek),
        })),
        tasks: tasks.map((t, i): AllocationTask => ({
          id: taskIds[i] ?? '',
          duration: t.duration,
          burden: new Map(memberIds.map((id, j) => [id, t.burden[j] ?? 1])),
          constraints: new Map(
            memberIds.flatMap((id, j) => {
              const c = t.constraints[j];
              return c ? [[id, c] as const] : [];
            }),
          ),
          ...(t.linkedTo ? { linkedTo: t.linkedTo } : {}),
        })),
        occurrences: occurrences.map(([t, hour], i) => {
          const start = monday
            .toZonedDateTime({ timeZone: calendar.timeZone })
            .add({ hours: hour });
          return {
            id: `o${String(i)}`,
            task: taskIds[t] ?? '',
            date: start.toPlainDate(),
            window: { start, end: start.add({ hours: 2 }) },
          };
        }),
        preAssigned: new Map(),
        carried: new Map(),
      };
    });

const links = (input: AllocationInput) =>
  new Map(input.tasks.flatMap((t) => (t.linkedTo ? [[t.id, t.linkedTo] as const] : [])));

describe('allocation invariants (ADR-0001 §7)', () => {
  it('assigns or leaves every occurrence exactly once, at its cost for the member', () => {
    fc.assert(
      fc.property(household({ constrained: true }), (input) => {
        const plan = allocate(input);
        const seen = [
          ...plan.assignments.map((a) => a.occurrence),
          ...plan.unassigned.map((u) => u.occurrence),
        ];
        expect(seen.sort()).toEqual(input.occurrences.map((o) => o.id).sort());
        for (const a of plan.assignments) {
          const occurrence = input.occurrences.find((o) => o.id === a.occurrence);
          const task = input.tasks.find((t) => t.id === occurrence?.task);
          expect(a.cost).toBe((task?.duration ?? 0) * (task?.burden.get(a.member) ?? 0));
        }
      }),
    );
  });

  it('only gives a unit to one member who is eligible for all of it, and bound to it if it is bound', () => {
    fc.assert(
      fc.property(household({ constrained: true }), (input) => {
        const assigned = new Map(allocate(input).assignments.map((a) => [a.occurrence, a.member]));
        for (const unit of allocationUnits(input.occurrences, links(input))) {
          const holders = new Set(unit.map((part) => assigned.get(part.id)));
          expect(holders.size).toBe(1);
          const [holder] = holders;
          if (holder === undefined) continue;
          const member = input.members.find((m) => m.id === holder);
          for (const part of unit) {
            const task = input.tasks.find((t) => t.id === part.task);
            if (!member || !task) throw new Error('generated input is inconsistent');
            expect(isEligible(member, task, part.window, input.week, input.calendar)).toBe(true);
            const bound = [...task.constraints].filter(([, c]) => c === 'bound').map(([id]) => id);
            if (bound.length) expect(bound).toContain(holder);
          }
        }
      }),
    );
  });

  it('does not depend on the order of its input', () => {
    fc.assert(
      fc.property(
        household({ constrained: true }).chain((input) =>
          fc.tuple(
            fc.constant(input),
            fc.shuffledSubarray([...input.members], { minLength: input.members.length }),
            fc.shuffledSubarray([...input.tasks], { minLength: input.tasks.length }),
            fc.shuffledSubarray([...input.occurrences], { minLength: input.occurrences.length }),
          ),
        ),
        ([input, members, tasks, occurrences]) => {
          expect(allocate({ ...input, members, tasks, occurrences })).toEqual(allocate(input));
        },
      ),
    );
  });

  it('keeps equal members within one unit of each other', () => {
    fc.assert(
      fc.property(household({ constrained: false }), (input) => {
        const loads = new Map(input.members.map((m) => [m.id, 0]));
        for (const a of allocate(input).assignments)
          loads.set(a.member, (loads.get(a.member) ?? 0) + a.cost);
        const largest = Math.max(
          0,
          ...allocationUnits(input.occurrences, links(input)).map((unit) =>
            unit.reduce(
              (sum, part) => sum + (input.tasks.find((t) => t.id === part.task)?.duration ?? 0),
              0,
            ),
          ),
        );
        expect(Math.max(...loads.values()) - Math.min(...loads.values())).toBeLessThanOrEqual(
          largest,
        );
      }),
    );
  });
});
