<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { useComparisons } from '#lib/hooks/use-comparisons.svelte.js';
  import { factorText } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const locale = getLocale();
  const game = useComparisons();
</script>

<svelte:head>
  <title>{m['comparisons.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['comparisons.title']()}</h1>
  <p>{m['comparisons.why']()}</p>

  <!-- A new summary for every refused answer, so it takes the focus again. -->
  {#key form}
    {#if form?.refused}
      <ErrorSummary heading={m['comparisons.not-saved']()} message={m['comparisons.changed']()} />
    {/if}
  {/key}

  <p role="status" class="wrap-break-word empty:hidden">
    {form?.answered ? m['comparisons.answered'](form.answered) : ''}
  </p>

  {#if data.pair}
    {@const [first, second] = data.pair}
    <form method="POST" action="?/answer" use:enhance={game.answer}>
      <fieldset class="flex min-w-0 flex-col gap-4">
        <legend class="mb-4">
          <!-- After an answer or a skip, the next question takes the focus: here when the page
               loads with it, as without JavaScript, and through the hook otherwise. -->
          <!-- svelte-ignore a11y_autofocus -->
          <h2
            id="question"
            tabindex="-1"
            autofocus={Boolean(form?.answered) || data.skipped > 0}
            {@attach game.question}
            class="text-lg font-semibold"
          >
            {m['comparisons.question']()}
          </h2>
        </legend>
        <input type="hidden" name="tasks" value={first.id} />
        <input type="hidden" name="tasks" value={second.id} />
        <!-- Both look the same, so neither answer is suggested; side by side where they fit. -->
        <div class="@container">
          <div class="grid gap-3 @sm:grid-cols-2">
            {#each [first, second] as task (task.id)}
              <Button
                type="submit"
                name="harder"
                value={task.id}
                variant="outline"
                class="min-h-20 px-4 py-4 text-lg wrap-break-word"
              >
                {task.name}
              </Button>
            {/each}
          </div>
        </div>
      </fieldset>
    </form>
    <!-- Skipping records nothing: it asks for the same page, one pair further on. -->
    <form method="GET" class="flex justify-center">
      <input type="hidden" name="skipped" value={data.skipped + 1} />
      <Button type="submit" variant="ghost" class="underline underline-offset-4">
        {m['comparisons.skip']()}
      </Button>
    </form>

    <section aria-labelledby="effect" class="flex flex-col gap-4">
      <h2 id="effect" class="text-lg font-semibold">{m['comparisons.effect']()}</h2>
      {#if data.answered}
        <p class="text-sm text-muted-foreground">
          {m['comparisons.effect-hint']({ average: factorText(1, locale) })}
        </p>
        <ul aria-labelledby="effect" class="flex flex-col divide-y rounded-lg border">
          {#each data.burdens as task (task.id)}
            <li class="p-4 wrap-break-word">
              {m['comparisons.counts']({
                task: task.name,
                factor: factorText(task.burden, locale),
              })}
            </li>
          {/each}
        </ul>
      {:else}
        <p>{m['comparisons.effect-none']()}</p>
      {/if}
    </section>
  {:else}
    <p>{m['comparisons.none']()}</p>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
  >
    {m['comparisons.back']({ household: data.household })}
  </a>
</main>
