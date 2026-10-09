<script lang="ts">
  import { page } from '$app/state';
  import PlanWeek from '#lib/components/PlanWeek.svelte';
  import { usePlan } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const plan = usePlan(() => data);
  /** Each week's heading, which takes the focus once publishing takes its button with it. */
  const headings = $state<Record<string, HTMLElement | undefined>>({});

  /** What publishing `week` did, in words (UI-12). */
  const statusOf = (week: string) =>
    form?.week === week && form.published ? m['plan.published']() : '';

  /** Why publishing `week` didn't go through, in words (CODE-13). */
  const problemOf = (week: string) => {
    if (form?.week !== week || !form.problem) return '';
    return form.problem === 'conflict' ? m['plan.changed']() : m['plan.gone']();
  };
</script>

<svelte:head>
  <title>{m['plan.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">{m['plan.title']()}</h1>
    <p>{m['plan.intro']()}</p>
  </div>

  {#if plan.weeks.length > 0}
    <p>{m['plan.any-time']()}</p>
  {:else}
    <p>{m['plan.none']()}</p>
  {/if}

  {#each plan.weeks as week (week.id)}
    <section aria-labelledby={week.id} class="flex flex-col gap-4">
      <PlanWeek
        {week}
        bind:heading={headings[week.id]}
        status={statusOf(week.start)}
        problem={problemOf(week.start)}
        attempt={form}
        publish={plan.publishThenFocus(() => headings[week.id])}
      />
    </section>
  {/each}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
  >
    {m['plan.back']({ household: data.household })}
  </a>
</main>
