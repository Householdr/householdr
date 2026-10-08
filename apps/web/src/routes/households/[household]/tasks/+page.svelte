<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { minutesText } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import type { NewTaskField } from '@householdr/application';
  import { frequencies, taskDuration, type Frequency } from '@householdr/domain';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const locale = getLocale();

  /** A frequency in words, never as its rule (ADR-0004 §3). */
  const often: Record<Frequency, () => string> = {
    daily: m['tasks.daily'],
    weekly: m['tasks.weekly'],
    biweekly: m['tasks.biweekly'],
    monthly: m['tasks.monthly'],
    'tri-monthly': m['tasks.tri-monthly'],
    yearly: m['tasks.yearly'],
  };

  /** Why the server refused a field, in words (CODE-13). */
  const problems: Record<NewTaskField, () => string> = {
    name: m['tasks.invalid-name'],
    duration: () => m['tasks.invalid-duration'](taskDuration),
    frequency: m['tasks.invalid-frequency'],
    start: m['tasks.invalid-start'],
  };
  const invalid = $derived(form?.invalid ?? []);
  const refused = $derived(invalid.map((id) => ({ id, problem: problems[id]() })));
  const problemOf = (field: NewTaskField) =>
    invalid.includes(field) ? problems[field]() : undefined;

  /** A field's own attributes for its hint and its problem, if the server refused it (UI-10). */
  const described = (field: NewTaskField, hint?: string) => {
    const refusedHere = invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${field}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };

  /** What the form shows: what was sent when it was refused, the defaults otherwise. */
  const values = $derived(
    form?.values ?? { name: '', duration: '', frequency: 'weekly', start: data.starts.earliest },
  );
</script>

<svelte:head>
  <title>{m['tasks.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="tasks" class="text-2xl font-semibold">{m['tasks.title']()}</h1>

  {#if data.tasks.length > 0}
    <ul aria-labelledby="tasks" class="flex flex-col divide-y rounded-lg border">
      {#each data.tasks as task (task.id)}
        <li class="flex flex-col gap-2 p-4">
          <span class="font-medium wrap-break-word">{task.name}</span>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-muted-foreground">{m['tasks.how-often']()}</dt>
            <dd>{often[task.frequency]()}</dd>
            <dt class="text-muted-foreground">{m['tasks.how-long']()}</dt>
            <dd>{minutesText(task.duration, locale)}</dd>
          </dl>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{m['tasks.none']()}</p>
  {/if}

  {#if data.mayAddTasks}
    <section aria-labelledby="add-task" class="flex flex-col gap-4">
      <h2 id="add-task" class="text-lg font-semibold">{m['tasks.add']()}</h2>

      <!-- A new summary for every attempt, so it takes the focus again. -->
      {#key form}
        {#if form?.invalid}
          <ErrorSummary
            heading={m['tasks.add-failed']()}
            message={m['tasks.check']()}
            fields={refused}
          />
        {/if}
      {/key}

      <p role="status" class="wrap-break-word empty:hidden">
        {form?.added ? m['tasks.added']({ name: form.added }) : ''}
      </p>

      <form method="POST" action="?/add" use:enhance class="flex flex-col gap-4">
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
              <NativeSelectOption value={frequency}>{often[frequency]()}</NativeSelectOption>
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
            min={data.starts.earliest}
            max={data.starts.latest}
            class="w-fit"
            value={values.start}
            {...described('start', 'start-hint')}
          />
          <p id="start-hint" class="text-sm text-muted-foreground">{m['tasks.start-hint']()}</p>
          <FieldProblem id="start-problem" problem={problemOf('start')} />
        </div>
        <Button type="submit" class="w-full">{m['tasks.submit']()}</Button>
      </form>
    </section>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
  >
    {m['tasks.back']({ household: data.household })}
  </a>
</main>
