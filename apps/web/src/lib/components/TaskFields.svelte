<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import ScheduleFields from '#lib/components/ScheduleFields.svelte';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useTaskRepeat } from '#lib/hooks/use-task-repeat.svelte.js';
  import { listOf } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { ScheduleValues } from '#lib/task-schedule.js';
  import { edgeDays, edgeDayWords, onMissWords, repeatWords, unitWords } from '#lib/task-words.js';
  import type { Repeat, TaskField } from '@householdr/application';
  import { taskDuration, taskInterval, type Interval, type PlanTask } from '@householdr/domain';

  /**
   * The fields of the form that adds or changes a task (ADR-0001 §1, ADR-0002 §2, ADR-0004 §3,
   * §8), showing `values`, with the `problems` of the fields the server refused (UI-10). The first
   * time is offered within `starts`; a reset form goes back to `startingOnMiss`. Counted from when
   * it was last done, a task has an interval instead of a choice of what happens if it isn't done,
   * and of when it is done: any time that week, or at set times around each date (§4). On an
   * advanced schedule, its editor takes the first time's place, its buttons sending the form to
   * `action` (§3). Sharing the dates of one of the `shareable` tasks, it has neither (§1); a task
   * that `sharesWith` others may give itself dates of its own instead of changing theirs.
   */
  let {
    values,
    invalid,
    problems,
    starts,
    dates,
    today,
    shareable,
    sharesWith,
    areas,
    startingOnMiss,
    action,
    submit,
    locale,
  }: {
    values: ScheduleValues & {
      name: string;
      duration: string;
      frequency: string;
      everyCount: string;
      everyUnit: string;
      start: string;
      onMiss: string;
      when: string;
      fromDay: string;
      fromTime: string;
      toDay: string;
      toTime: string;
      sharedWith: string;
      ownDates: string;
      areaId: string;
    };
    invalid: readonly TaskField[];
    problems: Record<TaskField, () => string>;
    starts: { earliest: string; latest: string };
    /** The days an extra date or a date to leave out can be on. */
    dates: { earliest: string; latest: string };
    /** `YYYY-MM-DD`: a new rule's first time. */
    today: string;
    /** The tasks on a calendar schedule whose dates it can share (ADR-0004 §1). */
    shareable: readonly { id: string; name: string }[];
    /** The names of the other tasks on its schedule, if it shares one. */
    sharesWith: readonly string[];
    /** The household's areas, one of which it can be in (ADR-0001 §1). */
    areas: readonly { id: string; name: string }[];
    startingOnMiss: PlanTask['onMiss'];
    action: string;
    /** The words of the form's own button, which Enter presses. */
    submit: string;
    locale: string;
  } = $props();

  const onMissChoices: PlanTask['onMiss'][] = ['roll over', 'lapse'];
  // Sharing another task's dates, once there is a task to share them with.
  const repeats = $derived(
    (Object.keys(repeatWords) as Repeat[]).filter(
      (choice) => choice !== 'shared' || shareable.length > 0,
    ),
  );
  const units = Object.keys(unitWords) as Interval['unit'][];

  const whenChoices = ['week', 'set'] as const;
  const repeat = useTaskRepeat(
    () => values.frequency,
    () => values.when,
  );
  let select = $state<HTMLSelectElement | null>(null);
  $effect(() => (select ? repeat.resetWith(select) : undefined));
  /** Whether the fields of one kind apply: always, until the page runs scripts. */
  const applies = (counted: boolean) => !repeat.running || repeat.counted === counted;
  /** Whether the window applies: always, until the page runs scripts. */
  const windowApplies = $derived(!repeat.running || repeat.atSetTimes);

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

<!-- Enter in a field saves: the form's default button comes before the editor's own buttons. -->
<button type="submit" hidden>{submit}</button>
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
{#if areas.length > 0}
  <div class="flex flex-col gap-2">
    <Label for="area">{m['tasks.area']()}</Label>
    <NativeSelect
      id="area"
      name="areaId"
      class="w-full"
      value={values.areaId}
      {...described('area')}
    >
      <NativeSelectOption value="">{m['tasks.no-area']()}</NativeSelectOption>
      {#each areas as area (area.id)}
        <NativeSelectOption value={area.id}>{area.name}</NativeSelectOption>
      {/each}
    </NativeSelect>
    <FieldProblem id="area-problem" problem={problemOf('area')} />
  </div>
{/if}
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
<!-- The task whose dates it shares (ADR-0004 §1, clarification). -->
<div class="flex flex-col gap-2" hidden={repeat.running && !repeat.sharing}>
  <Label for="sharedWith">{m['tasks.shared-with']()}</Label>
  <NativeSelect
    id="sharedWith"
    name="sharedWith"
    class="w-full"
    disabled={repeat.running && !repeat.sharing}
    required={repeat.running}
    value={values.sharedWith}
    {...described('sharedWith')}
  >
    {#each shareable as task (task.id)}
      <NativeSelectOption value={task.id}>{task.name}</NativeSelectOption>
    {/each}
  </NativeSelect>
  <FieldProblem id="sharedWith-problem" problem={problemOf('sharedWith')} />
</div>
{#if sharesWith.length > 0}
  <!-- New dates for a task that shares them change theirs too, unless they are its own. -->
  <div class="flex flex-col gap-1" hidden={repeat.running && (repeat.counted || repeat.sharing)}>
    <p class="text-sm wrap-break-word">
      {m['tasks.shared-note']({ tasks: listOf(sharesWith, locale) })}
    </p>
    <label class="flex min-h-11 items-center gap-3">
      <input
        type="checkbox"
        name="ownDates"
        checked={values.ownDates === 'on'}
        disabled={repeat.running && (repeat.counted || repeat.sharing)}
        class="size-5 shrink-0 accent-primary"
      />
      {m['tasks.own-dates']()}
    </label>
  </div>
{/if}
<!-- Made again with the form's values after each change of its rows, which the server sends. -->
{#key values}
  <ScheduleFields
    {values}
    apply={!repeat.running || repeat.advanced}
    {invalid}
    {problems}
    {today}
    {starts}
    {dates}
    {action}
    {locale}
  />
{/key}
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
<div class="flex flex-col gap-2" hidden={repeat.running && (repeat.advanced || repeat.sharing)}>
  <Label for="start">{m['tasks.start']()}</Label>
  <Input
    id="start"
    name="start"
    type="date"
    disabled={repeat.running && (repeat.advanced || repeat.sharing)}
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
<fieldset
  class="flex min-w-0 flex-col gap-1"
  hidden={!applies(false)}
  disabled={!applies(false)}
  aria-describedby={problemOf('when') ? 'when-problem' : undefined}
>
  <legend class="mb-1 text-sm font-medium">{m['tasks.when']()}</legend>
  {#each whenChoices as choice, i (choice)}
    <label class="flex min-h-11 items-center gap-3">
      <input
        id={i === 0 ? 'when' : undefined}
        type="radio"
        name="when"
        value={choice}
        required={repeat.running}
        checked={repeat.when === choice}
        defaultChecked={choice === 'week'}
        onchange={repeat.chooseWhen}
        class="size-5 shrink-0 accent-primary"
      />
      {choice === 'week' ? m['tasks.when-week']() : m['tasks.when-set']()}
    </label>
  {/each}
  <FieldProblem id="when-problem" problem={problemOf('when')} />
</fieldset>
<!-- The window around each date, for a task at set times (ADR-0004 §4, clarification). -->
<fieldset
  class="flex min-w-0 flex-col gap-2"
  hidden={!windowApplies}
  disabled={!windowApplies}
  aria-describedby={['window-hint', problemOf('window') ? 'window-problem' : '']
    .filter(Boolean)
    .join(' ')}
>
  <legend class="mb-1 text-sm font-medium">{m['tasks.window']()}</legend>
  <p id="window-hint" class="text-sm text-muted-foreground">{m['tasks.window-hint']()}</p>
  {#each [{ edge: 'from', day: 'fromDay', time: 'fromTime' }, { edge: 'to', day: 'toDay', time: 'toTime' }] as const as row (row.edge)}
    <div class="flex flex-wrap gap-3">
      <div class="flex flex-col gap-2">
        <!-- The summary's link to the window leads to its first field. -->
        <Label for={row.edge === 'from' ? 'window' : row.day}>
          {row.edge === 'from' ? m['tasks.window-from-day']() : m['tasks.window-to-day']()}
        </Label>
        <NativeSelect
          id={row.edge === 'from' ? 'window' : row.day}
          name={row.day}
          required={repeat.running}
          value={values[row.day]}
          aria-invalid={invalid.includes('window') || undefined}
        >
          {#each edgeDays as day (day)}
            <NativeSelectOption value={String(day)}>{edgeDayWords(day)}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="flex flex-col gap-2">
        <Label for={row.time}>
          {row.edge === 'from' ? m['tasks.window-from-time']() : m['tasks.window-to-time']()}
        </Label>
        <Input
          id={row.time}
          name={row.time}
          type="time"
          required={repeat.running}
          class="w-fit"
          value={values[row.time]}
          aria-invalid={invalid.includes('window') || undefined}
        />
      </div>
    </div>
  {/each}
  <FieldProblem id="window-problem" problem={problemOf('window')} />
</fieldset>
