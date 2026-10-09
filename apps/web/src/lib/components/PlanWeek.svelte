<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PlanItem from '#lib/components/PlanItem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import type { ShownWeek } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * One week's plan: who does what, each with why it went to them (ADR-0007 §5), and for heads, a
   * draft's note, what nobody could take, and publishing it early (ADR-0006 §2).
   */
  let {
    week,
    status,
    problem,
    taskProblem,
    attempt,
    publish,
    submit,
    heading = $bindable(),
  }: {
    week: ShownWeek;
    /** What publishing it, or marking one of its tasks done or undoing it, did (UI-12). */
    status: string;
    /** Why publishing it didn't go through, if it didn't. */
    problem: string;
    /** Why marking one of its tasks done, or undoing it, didn't go through, if it didn't. */
    taskProblem: {
      heading: string;
      message: string;
      fields: { id: string; problem: string }[];
    } | null;
    /** The answer to the last form sent, so a new summary takes the focus again. */
    attempt: unknown;
    /** How the publishing form is sent, with the focus kept (UI-7). */
    publish: SubmitFunction;
    /** How a task's forms are sent, with the focus kept (UI-7). */
    submit: (...targets: string[]) => SubmitFunction;
    /** The week's heading, which takes the focus once publishing takes its button with it. */
    heading?: HTMLElement;
  } = $props();
</script>

<h2 id={week.id} tabindex="-1" bind:this={heading} class="text-xl font-semibold wrap-break-word">
  {week.heading}
</h2>

<!-- A new summary for every attempt, so it takes the focus again. -->
{#key attempt}
  {#if taskProblem}
    <ErrorSummary {...taskProblem} />
  {/if}
{/key}

{#if week.draft}
  <p class="rounded-lg border p-4">{week.draft}</p>
{/if}

{#if week.publish}
  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key attempt}
    {#if problem}
      <ErrorSummary heading={m['plan.publish-failed']()} message={problem} />
    {/if}
  {/key}
  <form method="POST" action="?/publish" use:enhance={publish}>
    <input type="hidden" name="week" value={week.publish.week} />
    <input type="hidden" name="version" value={week.publish.version} />
    <Button type="submit" class="w-full" aria-describedby={week.id}>{m['plan.publish']()}</Button>
  </form>
{/if}
<p role="status" class="wrap-break-word empty:hidden">{status}</p>

{#each week.members as member (member.id)}
  <section aria-labelledby="{week.id}-{member.id}" class="flex flex-col gap-2">
    <h3 id="{week.id}-{member.id}" class="font-semibold wrap-break-word">{member.heading}</h3>
    {#if member.items.length > 0}
      <ul aria-labelledby="{week.id}-{member.id}" class="flex flex-col divide-y rounded-lg border">
        {#each member.items as item (item.id)}
          <PlanItem {item} {submit} />
        {/each}
      </ul>
    {:else}
      <p class="text-muted-foreground">{m['plan.nothing']()}</p>
    {/if}
  </section>
{/each}

{#if week.unassigned.length > 0}
  <section aria-labelledby="{week.id}-unassigned" class="flex flex-col gap-2">
    <h3 id="{week.id}-unassigned" class="font-semibold">{m['plan.unassigned']()}</h3>
    <p>{m['plan.unassigned-intro']()}</p>
    <ul aria-labelledby="{week.id}-unassigned" class="flex flex-col divide-y rounded-lg border">
      {#each week.unassigned as item (item.id)}
        <PlanItem {item} {submit} />
      {/each}
    </ul>
  </section>
{/if}
