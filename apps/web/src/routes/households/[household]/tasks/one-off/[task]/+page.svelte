<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import OneOffDetails from '#lib/components/OneOffDetails.svelte';
  import OneOffFields from '#lib/components/OneOffFields.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { oneOffFieldId, oneOffProblems } from '#lib/task-words.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** A one-off may keep the days it has, which may have passed (ADR-0004 §4). */
  const problems = {
    ...oneOffProblems,
    date: m['task.invalid-start'],
    deadline: m['task.invalid-deadline'],
  };
  const invalid = $derived(form?.invalid ?? []);
  const refused = $derived(
    invalid.map((field) => ({ id: oneOffFieldId(field), problem: problems[field]() })),
  );

  /** What the form shows: what was sent when saving didn't work, the one-off as saved otherwise. */
  const values = $derived(
    form?.values ?? { ...data.oneOff, duration: String(data.oneOff.duration) },
  );

  /**
   * Saves without emptying the form, which shows the one-off as saved, and loads it again after a
   * refusal too, as the page does without JavaScript.
   */
  const save: SubmitFunction =
    () =>
    ({ update }) =>
      update({ reset: false, refreshAll: true });
</script>

<svelte:head>
  <title>{m['task.page-title']({ task: data.oneOff.name, household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['task.title']()}</h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.conflict}
      <ErrorSummary heading={m['task.failed']()} message={m['task.conflict']()} />
      <!-- The one-off as it is now, to compare with what is still in the form (ADR-0019 §5). -->
      <section aria-labelledby="current" class="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="current" class="font-semibold">{m['task.current']()}</h2>
        <OneOffDetails oneOff={form.conflict.current} full locale={data.locale} />
      </section>
    {:else if refused.length > 0}
      <ErrorSummary heading={m['task.failed']()} message={m['tasks.check']()} fields={refused} />
    {/if}
  {/key}

  <p role="status" class="empty:hidden">{form?.saved ? m['task.saved']() : ''}</p>

  <form method="POST" action="?/save" use:enhance={save} class="flex flex-col gap-4">
    <input type="hidden" name="version" value={values.version} />
    <OneOffFields
      {values}
      {invalid}
      {problems}
      dates={data.dates}
      startingOnMiss={data.oneOff.onMiss}
    />
    <Button type="submit" class="w-full">{m['task.save']()}</Button>
  </form>

  <Button
    href="/households/{page.params.household}/tasks/one-off/{data.oneOff.id}/remove"
    variant="outline"
    class="self-start"
  >
    {m['task.remove']()}
  </Button>

  <a
    href="/households/{page.params.household}/tasks"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['task.back']()}
  </a>
</main>
