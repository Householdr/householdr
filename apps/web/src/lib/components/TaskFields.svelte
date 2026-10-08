<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { frequencyWords, onMissWords } from '#lib/task-words.js';
  import type { TaskField } from '@householdr/application';
  import { frequencies, taskDuration, type PlanTask } from '@householdr/domain';

  /**
   * The fields of the form that adds or changes a task (ADR-0001 §1, ADR-0002 §2, ADR-0004 §3),
   * showing `values`, with the `problems` of the fields the server refused (UI-10). The first time
   * is offered within `starts`; a reset form goes back to `startingOnMiss`.
   */
  let {
    values,
    invalid,
    problems,
    starts,
    startingOnMiss,
  }: {
    values: { name: string; duration: string; frequency: string; start: string; onMiss: string };
    invalid: readonly TaskField[];
    problems: Record<TaskField, () => string>;
    starts: { earliest: string; latest: string };
    startingOnMiss: PlanTask['onMiss'];
  } = $props();

  const onMissChoices: PlanTask['onMiss'][] = ['roll over', 'lapse'];

  const problemOf = (field: TaskField) => (invalid.includes(field) ? problems[field]() : undefined);

  /** A field's own attributes for its hint and its problem, if the server refused it (UI-10). */
  const described = (field: TaskField, hint?: string) => {
    const refusedHere = invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${field}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };
</script>

<div class="flex flex-col gap-2">
  <Label for="name">{m['tasks.name']()}</Label>
  <Input
    id="name"
    name="name"
    autocomplete="off"
    required
    maxlength={100}
    value={values.name}
    {...described('name', 'name-hint')}
  />
  <p id="name-hint" class="text-sm text-muted-foreground">{m['tasks.name-hint']()}</p>
  <FieldProblem id="name-problem" problem={problemOf('name')} />
</div>
<div class="flex flex-col gap-2">
  <Label for="duration">{m['tasks.duration']()}</Label>
  <Input
    id="duration"
    name="duration"
    type="number"
    inputmode="numeric"
    required
    min={taskDuration.min}
    max={taskDuration.max}
    step={1}
    class="w-32"
    value={values.duration}
    {...described('duration')}
  />
  <FieldProblem id="duration-problem" problem={problemOf('duration')} />
</div>
<div class="flex flex-col gap-2">
  <Label for="frequency">{m['tasks.how-often']()}</Label>
  <NativeSelect
    id="frequency"
    name="frequency"
    class="w-full"
    required
    value={values.frequency}
    {...described('frequency')}
  >
    {#each frequencies as frequency (frequency)}
      <NativeSelectOption value={frequency}>{frequencyWords[frequency]()}</NativeSelectOption>
    {/each}
  </NativeSelect>
  <FieldProblem id="frequency-problem" problem={problemOf('frequency')} />
</div>
<div class="flex flex-col gap-2">
  <Label for="start">{m['tasks.start']()}</Label>
  <Input
    id="start"
    name="start"
    type="date"
    required
    min={starts.earliest}
    max={starts.latest}
    class="w-fit"
    value={values.start}
    {...described('start', 'start-hint')}
  />
  <p id="start-hint" class="text-sm text-muted-foreground">{m['tasks.start-hint']()}</p>
  <FieldProblem id="start-problem" problem={problemOf('start')} />
</div>
<!-- Radios can't be marked invalid (ARIA 1.2); the group is described by its problem (UI-10). -->
<fieldset
  class="flex min-w-0 flex-col gap-1"
  aria-describedby={problemOf('onMiss') ? 'onMiss-problem' : undefined}
>
  <legend class="mb-1 text-sm font-medium">{m['tasks.on-miss']()}</legend>
  {#each onMissChoices as choice, i (choice)}
    <!-- The label around the radio makes the whole line its target (UI-8). The summary's link
         leads to the first one. A form that is reset goes back to the starting choice. -->
    <label class="flex min-h-11 items-center gap-3">
      <input
        id={i === 0 ? 'onMiss' : undefined}
        type="radio"
        name="onMiss"
        value={choice}
        required
        checked={values.onMiss === choice}
        defaultChecked={choice === startingOnMiss}
        class="size-5 shrink-0 accent-primary"
      />
      {onMissWords[choice]()}
    </label>
  {/each}
  <FieldProblem id="onMiss-problem" problem={problemOf('onMiss')} />
</fieldset>
