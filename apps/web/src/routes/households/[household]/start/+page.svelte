<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { useStart } from '#lib/hooks/use-start.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import { defaultStart } from '@householdr/domain';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const start = useStart(() => data.options);
  /** The choice the form shows: what was sent when it was refused, Start now otherwise. */
  const chosen = $derived(form?.when ?? defaultStart);
</script>

<svelte:head>
  <title>{m['start.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['start.title']()}</h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.problem}
      <ErrorSummary heading={m['start.failed']()} message={start.problem(form.problem)} />
    {/if}
  {/key}

  <!-- Started by someone else meanwhile: the summary says so, and there is nothing left to choose.
       Without JavaScript the page comes back without the choices already. -->
  {#if start.options.length > 0 && form?.problem !== 'already-started'}
    <p>{m['start.intro']()}</p>
    <form method="POST" use:enhance class="flex flex-col gap-6">
      <fieldset class="flex min-w-0 flex-col gap-4">
        <legend class="mb-2 font-semibold">{m['start.when']()}</legend>
        {#each start.options as option (option.value)}
          <div class="flex flex-col gap-1">
            <!-- The label around the radio makes the whole line its target (UI-8); the hint
                 says in plain words what the choice does. -->
            <label class="flex min-h-11 items-center gap-3 font-medium">
              <input
                id={option.id}
                type="radio"
                name="when"
                value={option.value}
                required
                checked={chosen === option.value}
                aria-describedby="{option.id}-hint"
                class="size-5 shrink-0 accent-primary"
              />
              <span class="wrap-break-word">{option.label}</span>
            </label>
            <p id="{option.id}-hint" class="ps-8 text-sm text-muted-foreground">{option.hint}</p>
          </div>
        {/each}
      </fieldset>
      <Button type="submit" class="w-full">{m['start.submit']()}</Button>
    </form>
  {:else if form?.problem !== 'already-started'}
    <p>{m['start.started']()}</p>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
  >
    {m['settings.back']()}
  </a>
</main>
