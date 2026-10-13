<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import OneOffDetails from '#lib/components/OneOffDetails.svelte';
  import OneOffFields from '#lib/components/OneOffFields.svelte';
  import TaskDetails from '#lib/components/TaskDetails.svelte';
  import TaskFields from '#lib/components/TaskFields.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { oneOffFieldId, oneOffProblems, taskProblems } from '#lib/task-words.js';
  import { defaultOnMiss } from '@householdr/domain';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const invalid = $derived(form?.invalid ?? []);
  const refused = $derived(invalid.map((id) => ({ id, problem: taskProblems[id]() })));

  /** What the form shows: what was sent when it was refused, the defaults otherwise. */
  const values = $derived(
    form?.values ?? {
      name: '',
      duration: '',
      frequency: 'weekly',
      everyCount: '',
      everyUnit: 'weeks',
      start: data.starts.earliest,
      onMiss: defaultOnMiss,
      // Any time that week, unless set: then the day itself, from 08:00 to 20:00 (ADR-0004 §4).
      when: 'week',
      fromDay: '0',
      fromTime: '08:00',
      toDay: '0',
      toTime: '20:00',
    },
  );

  const invalidOneOff = $derived(form?.invalidOneOff ?? []);
  const refusedOneOff = $derived(
    invalidOneOff.map((field) => ({ id: oneOffFieldId(field), problem: oneOffProblems[field]() })),
  );

  /**
   * What the one-off form shows: what was sent when it was refused, the defaults otherwise, today
   * as its day, which the plan page's shortcut leads to (ADR-0006 §3, clarification).
   */
  const oneOffValues = $derived(
    form?.oneOffValues ?? {
      name: '',
      duration: '',
      date: data.starts.earliest,
      deadline: '',
      onMiss: defaultOnMiss,
    },
  );
</script>

<svelte:head>
  <title>{m['tasks.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="tasks" class="text-2xl font-semibold">{m['tasks.title']()}</h1>

  <!-- After a task is removed on its own page, which leads back here. -->
  {#if data.removed && !form}
    <p role="status">{m['tasks.removed']()}</p>
  {/if}

  {#if data.tasks.length > 0}
    <ul aria-labelledby="tasks" class="flex flex-col divide-y rounded-lg border">
      {#each data.tasks as task (task.id)}
        <li class="flex flex-col gap-2 p-4">
          <span id="task-{task.id}" class="font-medium wrap-break-word">{task.name}</span>
          <TaskDetails {task} locale={data.locale} />
          {#if data.mayChangeTasks}
            <!-- Named with its task, as one of many such links (WCAG 2.4.4). -->
            <Button
              id="edit-{task.id}"
              href="/households/{page.params.household}/tasks/{task.id}"
              variant="outline"
              class="self-start"
              aria-labelledby="edit-{task.id} task-{task.id}"
            >
              {m['tasks.edit']()}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p>{m['tasks.none']()}</p>
  {/if}

  {#if data.oneOffs.length > 0}
    <section aria-labelledby="one-offs" class="flex flex-col gap-4">
      <h2 id="one-offs" class="text-lg font-semibold">{m['tasks.one-offs']()}</h2>
      <ul aria-labelledby="one-offs" class="flex flex-col divide-y rounded-lg border">
        {#each data.oneOffs as oneOff (oneOff.id)}
          <li class="flex flex-col gap-2 p-4">
            <span class="flex flex-wrap items-baseline gap-x-2">
              <span id="task-{oneOff.id}" class="font-medium wrap-break-word">{oneOff.name}</span>
              <!-- Done this plan week: it stays until the next one begins (ADR-0006 §3). -->
              {#if oneOff.done}
                <span class="text-sm text-muted-foreground">{m['tasks.one-off-done']()}</span>
              {/if}
            </span>
            <OneOffDetails {oneOff} locale={data.locale} />
            {#if oneOff.mayChange}
              <Button
                id="edit-{oneOff.id}"
                href="/households/{page.params.household}/tasks/one-off/{oneOff.id}"
                variant="outline"
                class="self-start"
                aria-labelledby="edit-{oneOff.id} task-{oneOff.id}"
              >
                {m['tasks.edit']()}
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data.mayAddOneOffs}
    <section aria-labelledby="add-one-off" class="flex flex-col gap-4">
      <h2 id="add-one-off" class="text-lg font-semibold">{m['tasks.add-one-off']()}</h2>
      <p>{m['tasks.add-one-off-intro']()}</p>

      <!-- A new summary for every attempt, so it takes the focus again. -->
      {#key form}
        {#if form?.invalidOneOff}
          <ErrorSummary
            heading={m['tasks.add-one-off-failed']()}
            message={m['tasks.check']()}
            fields={refusedOneOff}
          />
        {/if}
      {/key}

      <p role="status" class="wrap-break-word empty:hidden">
        {form?.addedOneOff ? m['tasks.added']({ name: form.addedOneOff }) : ''}
      </p>

      <form method="POST" action="?/addOneOff" use:enhance class="flex flex-col gap-4">
        <OneOffFields
          values={oneOffValues}
          invalid={invalidOneOff}
          problems={oneOffProblems}
          dates={data.starts}
          startingOnMiss={defaultOnMiss}
        />
        <Button type="submit" class="w-full">{m['tasks.add-one-off-submit']()}</Button>
      </form>
    </section>
  {/if}

  {#if data.mayChangeTasks}
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
        <TaskFields
          {values}
          {invalid}
          problems={taskProblems}
          starts={data.starts}
          startingOnMiss={defaultOnMiss}
        />
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
