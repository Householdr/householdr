<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useTaskRepeat } from '#lib/hooks/use-task-repeat.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import { onMissWords, repeatWords, unitWords } from '#lib/task-words.js';
  import type { Repeat, TaskField } from '@householdr/application';
  import { taskDuration, taskInterval, type Interval, type PlanTask } from '@householdr/domain';

  /**
   * The fields of the form that adds or changes a task (ADR-0001 §1, ADR-0002 §2, ADR-0004 §3,
   * §8), showing `values`, with the `problems` of the fields the server refused (UI-10). The first
   * time is offered within `starts`; a reset form goes back to `startingOnMiss`. Counted from when
   * it was last done, a task has an interval instead of a choice of what happens if it isn't done.
   */
  let {
    values,
    invalid,
    problems,
    starts,
    startingOnMiss,
  }: {
    values: {
      name: string;
      duration: string;
      frequency: string;
      everyCount: string;
      everyUnit: string;
      start: string;
      onMiss: string;
    };
    invalid: readonly TaskField[];
    problems: Record<TaskField, () => string>;
    starts: { earliest: string; latest: string };
    startingOnMiss: PlanTask['onMiss'];
  } = $props();

  const onMissChoices: PlanTask['onMiss'][] = ['roll over', 'lapse'];
  const repeats = Object.keys(repeatWords) as Repeat[];
  const units = Object.keys(unitWords) as Interval['unit'][];

  const repeat = useTaskRepeat(() => values.frequency);
  let select = $state<HTMLSelectElement | null>(null);
  $effect(() => (select ? repeat.resetWith(select) : undefined));
  /** Whether the fields of one kind apply: always, until the page runs scripts. */
  const applies = (counted: boolean) => !repeat.running || repeat.counted === counted;

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
    bind:ref={select}
    onchange={repeat.choose}
    {...described('frequency')}
  >
    {#each repeats as choice (choice)}
      <NativeSelectOption value={choice}>{repeatWords[choice]()}</NativeSelectOption>
    {/each}
  </NativeSelect>
  <FieldProblem id="frequency-problem" problem={problemOf('frequency')} />
</div>
<!-- Hidden and disabled while it doesn't apply, so it is neither checked nor sent. -->
<fieldset class="flex min-w-0 flex-col gap-2" hidden={!applies(true)} disabled={!applies(true)}>
  <legend class="mb-1 text-sm font-medium">{m['tasks.every']()}</legend>
  <div class="flex flex-wrap gap-3">
    <div class="flex flex-col gap-2">
      <Label for="everyCount">{m['tasks.every-count']()}</Label>
      <Input
        id="everyCount"
        name="everyCount"
        type="number"
        inputmode="numeric"
        required={repeat.running}
        min={1}
        max={taskInterval.days}
        step={1}
        class="w-24"
        value={values.everyCount}
        {...described('everyCount')}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="everyUnit">{m['tasks.every-unit']()}</Label>
      <NativeSelect
        id="everyUnit"
        name="everyUnit"
        required={repeat.running}
        value={values.everyUnit}
        {...described('everyUnit')}
      >
        {#each units as unit (unit)}
          <NativeSelectOption value={unit}>{unitWords[unit]()}</NativeSelectOption>
        {/each}
      </NativeSelect>
    </div>
  </div>
  <FieldProblem id="everyCount-problem" problem={problemOf('everyCount')} />
  <FieldProblem id="everyUnit-problem" problem={problemOf('everyUnit')} />
</fieldset>
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
  <p id="start-hint" class="text-sm text-muted-foreground">
    {repeat.running && repeat.counted ? m['tasks.first-due-hint']() : m['tasks.start-hint']()}
  </p>
  <FieldProblem id="start-problem" problem={problemOf('start')} />
</div>
<!-- Radios can't be marked invalid (ARIA 1.2); the group is described by its problem (UI-10). -->
<fieldset
  class="flex min-w-0 flex-col gap-1"
  hidden={!applies(false)}
  disabled={!applies(false)}
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
        required={repeat.running}
        checked={values.onMiss === choice}
        defaultChecked={choice === startingOnMiss}
        class="size-5 shrink-0 accent-primary"
      />
      {onMissWords[choice]()}
    </label>
  {/each}
  <FieldProblem id="onMiss-problem" problem={problemOf('onMiss')} />
</fieldset>
