/** A group of the task list: an area and its tasks, or the tasks without one (`id` undefined). */
export interface AreaGroup<T> {
  id?: string;
  name?: string;
  tasks: T[];
}

/**
 * The tasks grouped by area, in the areas' order, with those without an area last (ADR-0001 §1,
 * clarification). An area without tasks has no group.
 */
export function groupByArea<T extends { areaId?: string | undefined }>(
  tasks: readonly T[],
  areas: readonly { id: string; name: string }[],
): AreaGroup<T>[] {
  const groups: AreaGroup<T>[] = areas.map(({ id, name }) => ({
    id,
    name,
    tasks: tasks.filter((task) => task.areaId === id),
  }));
  const known = new Set(areas.map(({ id }) => id));
  groups.push({ tasks: tasks.filter((task) => !task.areaId || !known.has(task.areaId)) });
  return groups.filter((group) => group.tasks.length > 0);
}
