<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import TaskDetails from '#lib/components/TaskDetails.svelte';
  import TaskFields from '#lib/components/TaskFields.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { taskProblems } from '#lib/task-words.js';
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
      start: data.starts.earliest,
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
          <TaskDetails {task} />
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
