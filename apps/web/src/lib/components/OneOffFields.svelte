<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { oneOffFieldId, onMissWords } from '#lib/task-words.js';
  import type { OneOffField } from '@householdr/application';
  import { taskDuration, type PlanTask } from '@householdr/domain';

  /**
   * The fields of the form that adds or changes a one-off task (ADR-0004 §4, ADR-0002 §2,
   * clarification), showing `values`, with the `problems` of the fields the server refused
   * (UI-10). Its date is offered within `dates`, and so is its deadline, which may stay empty. A
   * reset form goes back to `startingOnMiss`. Their ids start with `one-off-`, so they never clash
   * with those of the form for other tasks on the same page.
   */
  let {
    values,
    invalid,
    problems,
    dates,
    startingOnMiss,
  }: {
    values: { name: string; duration: string; date: string; deadline: string; onMiss: string };
    invalid: readonly OneOffField[];
    problems: Record<OneOffField, () => string>;
    dates: { earliest: string; latest: string };
    startingOnMiss: PlanTask['onMiss'];
  } = $props();

  const onMissChoices: PlanTask['onMiss'][] = ['roll over', 'lapse'];
  const id = oneOffFieldId;

  const problemOf = (field: OneOffField) =>
    invalid.includes(field) ? problems[field]() : undefined;

  /** A field's own attributes for its hint and its problem, if the server refused it (UI-10). */
  const described = (field: OneOffField, hint?: string) => {
    const refusedHere = invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${id(field)}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };
</script>

<div class="flex flex-col gap-2">
  <Label for={id('name')}>{m['tasks.name']()}</Label>
  <Input
    id={id('name')}
    name="name"
    autocomplete="off"
    required
    maxlength={100}
    value={values.name}
    {...described('name', 'one-off-name-hint')}
  />
  <p id="one-off-name-hint" class="text-sm text-muted-foreground">
    {m['tasks.one-off-name-hint']()}
  </p>
  <FieldProblem id="{id('name')}-problem" problem={problemOf('name')} />
</div>
<div class="flex flex-col gap-2">
  <Label for={id('duration')}>{m['tasks.duration']()}</Label>
  <Input
    id={id('duration')}
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
  <FieldProblem id="{id('duration')}-problem" problem={problemOf('duration')} />
</div>
<div class="flex flex-col gap-2">
  <Label for={id('date')}>{m['tasks.one-off-date']()}</Label>
  <Input
    id={id('date')}
    name="date"
    type="date"
    required
    min={dates.earliest}
    max={dates.latest}
    class="w-fit"
    value={values.date}
    {...described('date', 'one-off-date-hint')}
  />
  <p id="one-off-date-hint" class="text-sm text-muted-foreground">
    {m['tasks.one-off-date-hint']()}
  </p>
  <FieldProblem id="{id('date')}-problem" problem={problemOf('date')} />
</div>
<div class="flex flex-col gap-2">
  <Label for={id('deadline')}>{m['tasks.one-off-deadline']()}</Label>
  <Input
    id={id('deadline')}
    name="deadline"
    type="date"
    min={dates.earliest}
    max={dates.latest}
    class="w-fit"
    value={values.deadline}
    {...described('deadline', 'one-off-deadline-hint')}
  />
  <p id="one-off-deadline-hint" class="text-sm text-muted-foreground">
    {m['tasks.one-off-deadline-hint']()}
  </p>
  <FieldProblem id="{id('deadline')}-problem" problem={problemOf('deadline')} />
</div>
<!-- Radios can't be marked invalid (ARIA 1.2); the group is described by its problem (UI-10). -->
<fieldset
  class="flex min-w-0 flex-col gap-1"
  aria-describedby={problemOf('onMiss') ? `${id('onMiss')}-problem` : undefined}
>
  <legend class="mb-1 text-sm font-medium">{m['tasks.on-miss']()}</legend>
  {#each onMissChoices as choice, i (choice)}
    <!-- The label around the radio makes the whole line its target (UI-8). The summary's link
         leads to the first one. A form that is reset goes back to the starting choice. -->
    <label class="flex min-h-11 items-center gap-3">
      <input
        id={i === 0 ? id('onMiss') : undefined}
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
  <FieldProblem id="{id('onMiss')}-problem" problem={problemOf('onMiss')} />
</fieldset>
