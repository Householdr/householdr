<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PlanWeek from '#lib/components/PlanWeek.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { usePlan } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const plan = usePlan(
    () => data,
    () => form,
  );
  /** Each week's heading, which takes the focus once publishing takes its button with it. */
  const headings = $state<Record<string, HTMLElement | undefined>>({});

  /**
   * What publishing `week`, drafting it again, or marking one of its tasks done or undoing it, did
   * (UI-12).
   */
  const statusOf = (week: string) => {
    if (form?.week === week && form.published) return m['plan.published']();
    if (form?.week === week && form.redrafted) return m['plan.redrafted']();
    return plan.statusOf(week);
  };

  /** Why publishing `week` didn't go through, in words (CODE-13). */
  const problemOf = (week: string) => {
    if (form?.week !== week || !form.problem || form.problem === 'redraft-gone') return '';
    return form.problem === 'conflict' ? m['plan.changed']() : m['plan.gone']();
  };

  /** Why drafting `week` again didn't go through, in words (CODE-13). */
  const redraftProblemOf = (week: string) =>
    form?.week === week && form.problem === 'redraft-gone' ? m['plan.redraft-gone']() : '';
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

  <!-- Swaps waiting for an answer, with what each does to both balances (ADR-0002 §5). -->
  {#if plan.swaps.length > 0 || plan.swapStatus() || plan.swapProblem()}
    <section aria-labelledby="swaps" class="flex flex-col gap-3">
      <h2 id="swaps" class="text-xl font-semibold">{m['plan.swaps']()}</h2>
      <p role="status" class="wrap-break-word empty:hidden">{plan.swapStatus()}</p>
      {#key form}
        {#if plan.swapProblem()}
          <ErrorSummary heading={m['plan.swap-failed']()} message={plan.swapProblem()} />
        {/if}
      {/key}
      <ul aria-labelledby="swaps" class="flex flex-col divide-y rounded-lg border">
        {#each plan.swaps as swap (swap.id)}
          <li class="flex flex-col gap-2 p-4">
            <p id="swap-{swap.id}" class="font-medium wrap-break-word">{swap.said}</p>
            <ul class="text-sm">
              {#each swap.balances as line, index (index)}
                <li class="wrap-break-word">{line}</li>
              {/each}
            </ul>
            {#if swap.mayAnswer}
              <form method="POST" action="?/answer" use:enhance class="flex flex-wrap gap-3">
                <input type="hidden" name="swap" value={swap.id} />
                <Button
                  type="submit"
                  name="answer"
                  value="accept"
                  aria-describedby="swap-{swap.id}"
                >
                  {m['plan.swap-accept']()}
                </Button>
                <Button
                  type="submit"
                  name="answer"
                  value="decline"
                  variant="outline"
                  aria-describedby="swap-{swap.id}"
                >
                  {m['plan.swap-decline']()}
                </Button>
              </form>
            {:else}
              <p class="text-sm wrap-break-word text-muted-foreground">{swap.waiting}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#each plan.weeks as week (week.id)}
    <section aria-labelledby={week.id} class="flex flex-col gap-4">
      <PlanWeek
        {week}
        bind:heading={headings[week.id]}
        status={statusOf(week.start)}
        problem={problemOf(week.start)}
        redraftProblem={redraftProblemOf(week.start)}
        taskProblem={plan.problemOf(week.start)}
        attempt={form}
        publish={plan.publishThenFocus(() => headings[week.id])}
        submit={plan.thenFocus}
      />
    </section>
  {/each}

  <!-- To the tasks page's form, which starts on today, so on this week (ADR-0006 §3). -->
  {#if data.mayAddOneOffs}
    <a
      href="/households/{page.params.household}/tasks#add-one-off"
      class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
    >
      {m['plan.add-one-off']()}
    </a>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
  >
    {m['plan.back']({ household: data.household })}
  </a>
</main>
