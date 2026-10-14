<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import OneOffDetails from '#lib/components/OneOffDetails.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** The one-off to confirm: as it is now, after it changed since the page was loaded (ADR-0019 §5). */
  const oneOff = $derived(form?.conflict.current ?? data.oneOff);
</script>

<svelte:head>
  <title>{m['task.remove-page-title']({ task: oneOff.name, household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold wrap-break-word">
    {m['task.remove-title']({ task: oneOff.name })}
  </h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.conflict}
      <ErrorSummary heading={m['task.remove-failed']()} message={m['task.remove-conflict']()} />
      <section aria-labelledby="current" class="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="current" class="font-semibold">{m['task.current']()}</h2>
        <OneOffDetails oneOff={form.conflict.current} full locale={data.locale} />
      </section>
    {/if}
  {/key}

  <p>{m['task.remove-one-off-intro']()}</p>

  <form method="POST" use:enhance class="flex flex-col gap-4">
    <input type="hidden" name="version" value={oneOff.version} />
    <Button type="submit" class="w-full">
      {m['task.remove-confirm']()}
    </Button>
  </form>

  <a
    href="/households/{page.params.household}/tasks/one-off/{oneOff.id}"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['task.keep']()}
  </a>
</main>
