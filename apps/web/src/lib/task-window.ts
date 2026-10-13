import type { TaskSummary } from '@householdr/application';

/** A fixed window as page data: its edges' times as `HH:MM` (ADR-0004 §4, clarification). */
export const windowData = ({ from, to }: NonNullable<TaskSummary['window']>) => ({
  from: { dayOffset: from.dayOffset, time: from.time.toString({ smallestUnit: 'minute' }) },
  to: { dayOffset: to.dayOffset, time: to.time.toString({ smallestUnit: 'minute' }) },
});

/** A task's window fields as its form shows them: set, or the form's start, the day itself 08:00–20:00. */
export const windowValues = (window: TaskSummary['window']) => {
  const shown = window && windowData(window);
  return {
    when: shown ? 'set' : 'week',
    fromDay: String(shown?.from.dayOffset ?? 0),
    fromTime: shown?.from.time ?? '08:00',
    toDay: String(shown?.to.dayOffset ?? 0),
    toTime: shown?.to.time ?? '20:00',
  };
};

/**
 * The window fields of a task's form as the use cases take them: only those that were sent, as a
 * form without scripts sends them all (ADR-0004 §4).
 */
export function windowInput(
  values: Record<'when' | 'fromDay' | 'fromTime' | 'toDay' | 'toTime', string>,
) {
  return {
    when: values.when || undefined,
    fromDay: values.fromDay ? Number(values.fromDay) : undefined,
    fromTime: values.fromTime || undefined,
    toDay: values.toDay ? Number(values.toDay) : undefined,
    toTime: values.toTime || undefined,
  };
}
