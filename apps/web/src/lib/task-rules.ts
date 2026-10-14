import type { EditableTask } from '@householdr/application';

/** The name of a member's constraint in the task's form: `constraint-` and their id. */
export const constraintField = (memberId: string) => `constraint-${memberId}`;

/** Who does a task, as its form shows it: its minimum age, and each member's constraint by id. */
export const rulesValues = (task: Pick<EditableTask, 'minimumAge' | 'constraints'>) => ({
  minimumAge: task.minimumAge === undefined ? '' : String(task.minimumAge),
  constraints: Object.fromEntries(task.constraints.map((c) => [c.memberId, c.constraint])),
});

/** Who does a task, as its form sent it: the minimum age, and the constraints that were chosen. */
export function sentRules(form: FormData) {
  const constraints: Record<string, string> = {};
  for (const [field, value] of form) {
    if (field.startsWith('constraint-') && typeof value === 'string' && value !== '') {
      constraints[field.slice('constraint-'.length)] = value;
    }
  }
  const age = form.get('minimumAge');
  return { minimumAge: typeof age === 'string' ? age : '', constraints };
}

/** Who does a task as the use case takes it (ADR-0001 §3). */
export const rulesInput = (values: ReturnType<typeof sentRules>) => ({
  minimumAge: values.minimumAge ? Number(values.minimumAge) : undefined,
  constraints: Object.entries(values.constraints).map(([memberId, constraint]) => ({
    memberId,
    constraint,
  })),
});
