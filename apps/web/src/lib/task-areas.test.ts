import { describe, expect, it } from 'vitest';
import { groupByArea } from './task-areas';

// The task list grouped by area (ADR-0001 §1, clarification).

describe('groupByArea (ADR-0001 §1)', () => {
  const areas = [
    { id: 'b', name: 'Bathroom' },
    { id: 'g', name: 'Garden' },
    { id: 'k', name: 'Kitchen' },
  ];

  it('follows the areas’ order, leaves out empty ones, and puts tasks without one last', () => {
    const tasks = [
      { name: 'Dishes', areaId: 'k' },
      { name: 'Bills' },
      { name: 'Shower', areaId: 'b' },
      { name: 'Sink', areaId: 'k' },
    ];
    expect(groupByArea(tasks, areas)).toEqual([
      { id: 'b', name: 'Bathroom', tasks: [{ name: 'Shower', areaId: 'b' }] },
      {
        id: 'k',
        name: 'Kitchen',
        tasks: [
          { name: 'Dishes', areaId: 'k' },
          { name: 'Sink', areaId: 'k' },
        ],
      },
      { tasks: [{ name: 'Bills' }] },
    ]);
  });

  it('is one group without a name when the household has no areas', () => {
    const dishes: { name: string; areaId?: string } = { name: 'Dishes' };
    expect(groupByArea([dishes], [])).toEqual([{ tasks: [dishes] }]);
  });
});
