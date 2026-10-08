import { describe, expect, it } from 'vitest';
import type { HouseholdCalendar } from '../schedules/week';
import {
  allocate,
  type AllocationInput,
  type AllocationMember,
  type AllocationTask,
} from './allocate';
import type { Constraint } from './eligibility';
import type { PlannedOccurrence } from './units';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Brussels]`);
const brussels: HouseholdCalendar = { timeZone: 'Europe/Brussels', weekStartDay: 1 };

const member = (id: string, fields: Partial<AllocationMember> = {}): AllocationMember => ({
  id,
  fairFraction: 0.5,
  availability: { absences: [], unavailable: [] },
  balance: 0,
  load: 0,
  lastWeek: new Set(),
  ...fields,
});
const task = (
  id: string,
  duration: number,
  fields: {
    burden?: Record<string, number>;
    constraints?: Record<string, Constraint>;
    linkedTo?: string;
  } = {},
): AllocationTask => ({
  id,
  duration,
  burden: new Map(Object.entries({ ann: 1, bob: 1, cas: 1, ...fields.burden })),
  constraints: new Map(Object.entries(fields.constraints ?? {})),
  ...(fields.linkedTo ? { linkedTo: fields.linkedTo } : {}),
});
const occurrence = (id: string, taskId: string, start: string, hours = 1): PlannedOccurrence => {
  const begin = at(start);
  return {
    id,
    task: taskId,
    date: begin.toPlainDate(),
    window: { start: begin, end: begin.add({ hours }) },
  };
};
const week = (input: Partial<AllocationInput>): AllocationInput => ({
  week: date('2026-10-12'),
  calendar: brussels,
  rebalanceRate: 0.25,
  members: [member('ann'), member('bob')],
  tasks: [],
  occurrences: [],
  preAssigned: new Map(),
  carried: new Map(),
  ...input,
});
const who = (input: AllocationInput) =>
  Object.fromEntries(allocate(input).assignments.map((a) => [a.occurrence, a.member]));
const reasons = (input: AllocationInput) =>
  Object.fromEntries(allocate(input).assignments.map((a) => [a.occurrence, a.reason]));
const away = (day: string) => ({ absences: [{ from: date(day), to: date(day) }], unavailable: [] });

// Week of Monday 12 October 2026.
const dishes = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    occurrence(`dishes-${String(i + 1)}`, 'dishes', `2026-10-${String(12 + i)}T19:00`),
  );

describe('allocate (ADR-0001 §7)', () => {
  it('splits a daily task between two equal members', () => {
    const plan = allocate(week({ tasks: [task('dishes', 30)], occurrences: dishes(7) }));
    const count = (id: string) => plan.assignments.filter((a) => a.member === id).length;
    expect([count('ann'), count('bob')].sort()).toEqual([3, 4]);
    expect(plan.unassigned).toEqual([]);
  });

  it('gives a task to whoever minds it least', () => {
    const input = week({
      tasks: [task('iron', 60, { burden: { ann: 0.8, bob: 1.2 } })],
      occurrences: [occurrence('iron', 'iron', '2026-10-13T10:00', 8)],
    });
    expect(allocate(input).assignments).toEqual([
      { occurrence: 'iron', member: 'ann', cost: 48, reason: 'lowest relative load' },
    ]);
  });

  it('divides by the fair fraction', () => {
    // 70% and 30%: three of four equal occurrences to Ann.
    const input = week({
      members: [member('ann', { fairFraction: 0.7 }), member('bob', { fairFraction: 0.3 })],
      tasks: [task('dishes', 30)],
      occurrences: dishes(4),
    });
    expect(Object.values(who(input)).sort()).toEqual(['ann', 'ann', 'ann', 'bob']);
  });

  it('starts from the loads already in the week', () => {
    const input = week({
      members: [member('ann'), member('bob', { load: 100 })],
      tasks: [task('dishes', 30)],
      occurrences: dishes(1),
    });
    expect(who(input)).toEqual({ 'dishes-1': 'ann' });
  });
});

describe('sorting (ADR-0001 §7, step 4)', () => {
  it('places units with fewer eligible members first', () => {
    // Without sorting, Ann would take the earlier vacuuming, and then the windows only she can do.
    const input = week({
      members: [member('ann', { fairFraction: 0.6 }), member('bob', { fairFraction: 0.4 })],
      tasks: [task('vacuum', 30), task('windows', 30, { constraints: { bob: 'excluded' } })],
      occurrences: [
        occurrence('vacuum', 'vacuum', '2026-10-12T10:00'),
        occurrence('windows', 'windows', '2026-10-13T10:00'),
      ],
    });
    expect(who(input)).toEqual({ vacuum: 'bob', windows: 'ann' });
    expect(reasons(input).windows).toBe('only eligible member');
  });

  it('places longer units first', () => {
    const input = week({
      members: [member('ann', { fairFraction: 0.6 }), member('bob', { fairFraction: 0.4 })],
      tasks: [task('tidy', 30), task('garden', 90)],
      occurrences: [
        occurrence('tidy', 'tidy', '2026-10-12T10:00'),
        occurrence('garden', 'garden', '2026-10-13T10:00'),
      ],
    });
    expect(who(input)).toEqual({ tidy: 'bob', garden: 'ann' });
  });
});

describe('bound tasks (ADR-0001 §7, step 3)', () => {
  it('go to their member first, which shifts the rest to the others', () => {
    const input = week({
      tasks: [task('cook', 60, { constraints: { ann: 'bound' } }), task('dishes', 30)],
      occurrences: [occurrence('cook', 'cook', '2026-10-14T17:00'), ...dishes(2)],
    });
    expect(who(input)).toEqual({ 'dishes-1': 'bob', 'dishes-2': 'bob', cook: 'ann' });
    expect(reasons(input).cook).toBe('bound');
  });

  it('are placed before longer free units', () => {
    // Cooking first goes to Ann, so the garden goes to Bob. The garden first would turn that around.
    const input = week({
      members: [member('ann'), member('bob', { load: 20 })],
      tasks: [
        task('cook', 30, { constraints: { ann: 'bound', bob: 'bound' } }),
        task('garden', 90),
      ],
      occurrences: [
        occurrence('garden', 'garden', '2026-10-12T10:00', 8),
        occurrence('cook', 'cook', '2026-10-14T17:00'),
      ],
    });
    expect(who(input)).toEqual({ cook: 'ann', garden: 'bob' });
  });

  it('go to the bound member with the lowest relative load when several are bound', () => {
    const input = week({
      members: [member('ann', { load: 60 }), member('bob'), member('cas')],
      tasks: [task('cook', 60, { constraints: { ann: 'bound', bob: 'bound' } })],
      occurrences: [occurrence('cook', 'cook', '2026-10-14T17:00')],
    });
    expect(allocate(input).assignments).toEqual([
      { occurrence: 'cook', member: 'bob', cost: 60, reason: 'bound' },
    ]);
  });

  it('stay unassigned when the bound member is away', () => {
    const input = week({
      members: [member('ann', { availability: away('2026-10-14') }), member('bob')],
      tasks: [task('cook', 60, { constraints: { ann: 'bound' } })],
      occurrences: [occurrence('cook', 'cook', '2026-10-14T17:00')],
    });
    expect(allocate(input)).toEqual({
      assignments: [],
      unassigned: [{ occurrence: 'cook', cause: 'bound member not eligible' }],
    });
  });
});

describe('unassigned occurrences (ADR-0001 §7, clarification)', () => {
  it('stay unassigned when nobody is eligible', () => {
    const input = week({
      members: [member('ann', { availability: away('2026-10-13') }), member('bob')],
      tasks: [task('dishes', 30, { constraints: { bob: 'excluded' } })],
      occurrences: dishes(2),
    });
    expect(allocate(input)).toEqual({
      assignments: [
        { occurrence: 'dishes-1', member: 'ann', cost: 30, reason: 'only eligible member' },
      ],
      unassigned: [{ occurrence: 'dishes-2', cause: 'nobody eligible' }],
    });
  });

  it('never go to a member with a share of 0', () => {
    const input = week({
      members: [member('ann', { fairFraction: 0 }), member('bob', { fairFraction: 0 })],
      tasks: [task('dishes', 30)],
      occurrences: dishes(1),
    });
    expect(allocate(input).unassigned).toEqual([
      { occurrence: 'dishes-1', cause: 'nobody eligible' },
    ]);
  });
});

describe('catching up (ADR-0002 §3)', () => {
  const iron = (balance: Record<string, number>, burden: Record<string, number>) =>
    week({
      members: [
        member('ann', { balance: balance.ann ?? 0 }),
        member('bob', { balance: balance.bob ?? 0 }),
      ],
      tasks: [task('iron', 30, { burden })],
      occurrences: [occurrence('iron', 'iron', '2026-10-13T10:00', 8)],
    });

  it('gives more to a member in deficit, and says so when it changed the pick', () => {
    // Ann minds it a little more (33 against 30 points), but is 40 points behind.
    const input = iron({ ann: -40 }, { ann: 1.1 });
    expect(who(input)).toEqual({ iron: 'ann' });
    expect(reasons(input).iron).toBe('catching up');
  });

  it('gives less to a member who is ahead', () => {
    // Ann minds it less (27 points), but is 40 points ahead.
    const input = iron({ ann: 40 }, { ann: 0.9 });
    expect(who(input)).toEqual({ iron: 'bob' });
    expect(reasons(input).iron).toBe('catching up');
  });

  it('says "lowest relative load" when the pick would have been the same', () => {
    const input = iron({ ann: -40 }, { ann: 0.9 });
    expect(who(input)).toEqual({ iron: 'ann' });
    expect(reasons(input).iron).toBe('lowest relative load');
  });
});

describe('rotation (ADR-0001 §7, step 5)', () => {
  const vacuum = (burden: number) =>
    week({
      members: [member('ann', { lastWeek: new Set(['vacuum']) }), member('bob')],
      tasks: [task('vacuum', 30, { burden: { ann: burden } })],
      occurrences: [occurrence('vacuum', 'vacuum', '2026-10-13T10:00', 8)],
    });

  it('passes a task on when the last holder only minds it a little less', () => {
    // 28.5 points plus 10% is more than Bob's 30.
    expect(who(vacuum(0.95))).toEqual({ vacuum: 'bob' });
  });

  it('keeps it with the last holder when they mind it much less, at the plain cost', () => {
    // 25.5 points plus 10% is still less than 30.
    expect(allocate(vacuum(0.85)).assignments).toEqual([
      { occurrence: 'vacuum', member: 'ann', cost: 25.5, reason: 'lowest relative load' },
    ]);
  });
});

describe('same-person links (ADR-0001 §7, step 2)', () => {
  const bins = [task('out', 5, { linkedTo: 'in' }), task('in', 5)];
  const binWeek = [
    occurrence('out', 'out', '2026-10-12T18:00', 13),
    occurrence('in', 'in', '2026-10-13T08:00', 14),
  ];

  it('give both parts to one member, each at its own cost', () => {
    const burden = { ann: 2, bob: 3 };
    const tasks = [task('out', 5, { linkedTo: 'in', burden }), task('in', 10, { burden })];
    expect(allocate(week({ tasks, occurrences: binWeek })).assignments).toEqual([
      { occurrence: 'out', member: 'ann', cost: 10, reason: 'lowest relative load' },
      { occurrence: 'in', member: 'ann', cost: 20, reason: 'lowest relative load' },
    ]);
  });

  it('need the member for every part', () => {
    const input = week({
      members: [member('ann', { availability: away('2026-10-13') }), member('bob', { load: 50 })],
      tasks: bins,
      occurrences: binWeek,
    });
    expect(who(input)).toEqual({ out: 'bob', in: 'bob' });
  });

  it('carry over from last week to the same member', () => {
    const input = week({
      tasks: bins,
      occurrences: [occurrence('in', 'in', '2026-10-12T08:00', 14)],
      carried: new Map([['in', 'bob']]),
    });
    expect(allocate(input).assignments).toEqual([
      { occurrence: 'in', member: 'bob', cost: 5, reason: 'linked' },
    ]);
  });

  it('stay unassigned when last week’s member is not eligible', () => {
    const input = week({
      members: [member('ann'), member('bob', { availability: away('2026-10-12') })],
      tasks: bins,
      occurrences: [occurrence('in', 'in', '2026-10-12T08:00', 14)],
      carried: new Map([['in', 'bob']]),
    });
    expect(allocate(input).unassigned).toEqual([
      { occurrence: 'in', cause: 'linked member not eligible' },
    ]);
  });
});

describe('head pre-assignments (ADR-0006 §2)', () => {
  it('are kept and charged first', () => {
    const input = week({
      tasks: [task('garden', 120), task('dishes', 30)],
      occurrences: [occurrence('garden', 'garden', '2026-10-17T10:00', 8), ...dishes(2)],
      preAssigned: new Map([['garden', 'ann']]),
    });
    expect(who(input)).toEqual({ 'dishes-1': 'bob', 'dishes-2': 'bob', garden: 'ann' });
    expect(reasons(input).garden).toBe('assigned by head');
  });

  it('hold even when the member would not be eligible', () => {
    const input = week({
      tasks: [task('garden', 120, { constraints: { ann: 'excluded' } })],
      occurrences: [occurrence('garden', 'garden', '2026-10-17T10:00', 8)],
      preAssigned: new Map([['garden', 'ann']]),
    });
    expect(who(input)).toEqual({ garden: 'ann' });
  });

  it('place a whole linked unit, except parts assigned to someone else', () => {
    const bins = [
      task('out', 5, { linkedTo: 'in' }),
      task('in', 5, { linkedTo: 'wash' }),
      task('wash', 5),
    ];
    const occurrences = [
      occurrence('out', 'out', '2026-10-12T18:00', 13),
      occurrence('in', 'in', '2026-10-13T08:00', 14),
      occurrence('wash', 'wash', '2026-10-13T10:00', 8),
    ];
    expect(who(week({ tasks: bins, occurrences, preAssigned: new Map([['in', 'bob']]) }))).toEqual({
      out: 'bob',
      in: 'bob',
      wash: 'bob',
    });
    expect(
      who(
        week({
          tasks: bins,
          occurrences,
          preAssigned: new Map([
            ['out', 'ann'],
            ['wash', 'bob'],
          ]),
        }),
      ),
    ).toEqual({ out: 'ann', in: 'ann', wash: 'bob' });
  });
});

describe('ties (ADR-0001 §7, step 6)', () => {
  it('break the same way whatever order the members come in', () => {
    const base = week({ tasks: [task('dishes', 30)], occurrences: dishes(1) });
    const reversed = { ...base, members: base.members.toReversed() };
    expect(who(reversed)).toEqual(who(base));
  });

  it('do not always favour the same member', () => {
    const winners = new Set(
      Array.from({ length: 12 }, (_, i) => {
        const id = `task-${String(i)}`;
        return who(
          week({ tasks: [task(id, 30)], occurrences: [occurrence('o', id, '2026-10-13T10:00')] }),
        ).o;
      }),
    );
    expect(winners).toEqual(new Set(['ann', 'bob']));
  });

  it('break the same way whichever day of the plan week is given, a transition week too', () => {
    // Monday weeks to Thursday weeks from 12 October: one plan week from 12 to 21 October.
    const toThursdays: HouseholdCalendar = {
      ...brussels,
      weekStartDay: 4,
      change: { from: date('2026-10-12'), previous: 1 },
    };
    const winners = (day: string) =>
      Array.from({ length: 12 }, (_, i) => {
        const id = `task-${String(i)}`;
        const occurrences = [occurrence('o', id, '2026-10-13T10:00')];
        return who(
          week({ week: date(day), calendar: toThursdays, tasks: [task(id, 30)], occurrences }),
        ).o;
      });
    expect(winners('2026-10-21')).toEqual(winners('2026-10-12'));
  });
});

describe('input checks', () => {
  it('rejects an occurrence of an unknown task, or a missing burden', () => {
    expect(() => allocate(week({ occurrences: dishes(1) }))).toThrow(RangeError);
    const noBurden = { ...task('dishes', 30), burden: new Map([['ann', 1]]) };
    expect(() => allocate(week({ tasks: [noBurden], occurrences: dishes(1) }))).toThrow(RangeError);
  });
});
