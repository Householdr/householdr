<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { constraintField } from '#lib/task-rules.js';
  import type { TaskField } from '@householdr/application';

  /**
   * Who does a task, on its page, which only heads see (ADR-0001 §3, clarification): its minimum
   * age, and for each of the household's `members` whether it is always theirs, never theirs, or,
   * for a child, theirs below that age too; and which of the `linkable` tasks goes to the same
   * member next (§7). Shows `values`, with the `problems` of the fields the server refused (UI-10).
   */
  let {
    values,
    members,
    linkable,
    invalid,
    problems,
  }: {
    values: { minimumAge: string; constraints: Record<string, string>; linkedTo: string };
    members: readonly { id: string; name: string; child: boolean }[];
    linkable: readonly { id: string; name: string }[];
    invalid: readonly TaskField[];
    problems: Record<TaskField, () => string>;
  } = $props();

  const problemOf = (field: TaskField) => (invalid.includes(field) ? problems[field]() : undefined);
</script>

<fieldset class="flex min-w-0 flex-col gap-4" aria-describedby="who-hint">
  <legend class="mb-1 text-sm font-medium">{m['task.who']()}</legend>
  <p id="who-hint" class="text-sm text-muted-foreground">{m['task.who-hint']()}</p>
  <div class="flex flex-col gap-2">
    <Label for="minimumAge">{m['task.minimum-age']()}</Label>
    <Input
      id="minimumAge"
      name="minimumAge"
      type="number"
      inputmode="numeric"
      min={1}
      max={17}
      step={1}
      class="w-24"
      value={values.minimumAge}
      aria-invalid={invalid.includes('minimumAge') || undefined}
      aria-describedby={['minimumAge-hint', problemOf('minimumAge') ? 'minimumAge-problem' : '']
        .filter(Boolean)
        .join(' ')}
    />
    <p id="minimumAge-hint" class="text-sm text-muted-foreground">
      {m['task.minimum-age-hint']()}
    </p>
    <FieldProblem id="minimumAge-problem" problem={problemOf('minimumAge')} />
  </div>
  {#each members as member, i (member.id)}
    <div class="flex flex-col gap-2">
      <!-- The summary's link to the constraints leads to the first member's. -->
      <Label for={i === 0 ? 'constraints' : constraintField(member.id)} class="wrap-break-word">
        {member.name}
      </Label>
      <NativeSelect
        id={i === 0 ? 'constraints' : constraintField(member.id)}
        name={constraintField(member.id)}
        class="w-full"
        value={values.constraints[member.id] ?? ''}
        aria-invalid={invalid.includes('constraints') || undefined}
      >
        <NativeSelectOption value="">{m['task.constraint-none']()}</NativeSelectOption>
        <NativeSelectOption value="bound">{m['task.constraint-bound']()}</NativeSelectOption>
        <NativeSelectOption value="excluded">{m['task.constraint-excluded']()}</NativeSelectOption>
        {#if member.child}
          <NativeSelectOption value="allowed">{m['task.constraint-allowed']()}</NativeSelectOption>
        {/if}
      </NativeSelect>
    </div>
  {/each}
  <FieldProblem id="constraints-problem" problem={problemOf('constraints')} />
  {#if linkable.length > 0}
    <div class="flex flex-col gap-2">
      <Label for="linkedTo">{m['task.linked-to']()}</Label>
      <NativeSelect
        id="linkedTo"
        name="linkedTo"
        class="w-full"
        value={values.linkedTo}
        aria-invalid={invalid.includes('linkedTo') || undefined}
        aria-describedby={['linkedTo-hint', problemOf('linkedTo') ? 'linkedTo-problem' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <NativeSelectOption value="">{m['task.linked-to-none']()}</NativeSelectOption>
        {#each linkable as task (task.id)}
          <NativeSelectOption value={task.id}>{task.name}</NativeSelectOption>
        {/each}
      </NativeSelect>
      <p id="linkedTo-hint" class="text-sm text-muted-foreground">{m['task.linked-to-hint']()}</p>
      <FieldProblem id="linkedTo-problem" problem={problemOf('linkedTo')} />
    </div>
  {/if}
</fieldset>
