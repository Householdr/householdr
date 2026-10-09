<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import type { ShownItem } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * A task in a week's plan: its day, its points for the reader, and why (ADR-0007 §5); once done,
   * by whom, on which day, and undoing it; while it can be, marking it done with one tap, or
   * choosing who did it (ADR-0006 §4).
   */
  let {
    item,
    submit,
  }: {
    item: ShownItem;
    /**
     * How a form of the task is sent, then the focus moved to the first of the controls named
     * that is there once it went through (UI-7).
     */
    submit?: (...targets: string[]) => SubmitFunction;
  } = $props();

  const { key } = $derived(item);
  /** Once it is done: Undo, or what says who did it. Once undone: Done, or the choice of who. */
  const afterDone = $derived([`${key}-undo`, `${key}-done`]);
  const afterUndo = $derived([`${key}-complete`, `${key}-summary`]);
</script>

<li class="flex flex-col gap-2 p-4">
  <span class="font-medium wrap-break-word">{item.task}</span>
  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
    <dt class="text-muted-foreground">{m['plan.day']()}</dt>
    <dd>
      {#if item.anyDay}
        {item.day}
      {:else}
        <time datetime={item.date}>{item.day}</time>
      {/if}
    </dd>
    {#if item.points !== null}
      <dt class="text-muted-foreground">{m['plan.points-label']()}</dt>
      <dd>{item.points}</dd>
    {/if}
    <dt class="text-muted-foreground">{m['plan.why']()}</dt>
    <dd class="wrap-break-word">{item.why}</dd>
  </dl>

  {#if item.done}
    <!-- The day only for others, the time too for those it credits (ADR-0018 §3). -->
    <p id="{key}-done" tabindex="-1" class="font-medium wrap-break-word">{item.done.said}</p>
    {#if item.done.loggedBy}
      <p class="text-sm wrap-break-word text-muted-foreground">{item.done.loggedBy}</p>
    {/if}
    {#if item.done.undo && submit}
      <form method="POST" action="?/undo" use:enhance={submit(...afterUndo)}>
        <input type="hidden" name="occurrence" value={item.occurrence} />
        <input type="hidden" name="completion" value={item.done.undo.completion} />
        <Button id="{key}-undo" type="submit" variant="outline" aria-label={item.done.undo.label}>
          {m['plan.undo']()}
        </Button>
      </form>
    {/if}
  {/if}

  {#if item.complete && submit}
    {#if item.complete.own}
      <form method="POST" action="?/complete" use:enhance={submit(...afterDone)}>
        <input type="hidden" name="occurrence" value={item.occurrence} />
        <Button id="{key}-complete" type="submit" class="w-full" aria-label={item.complete.own}>
          {m['plan.done-button']()}
        </Button>
      </form>
    {/if}
    <!-- Open when the choice needs changing, so the problem shows next to it (UI-10). -->
    <details open={item.complete.problem !== null}>
      <!-- Its own marker shows it opens, not leaves, and the padding makes it 44 px high (UI-8). -->
      <summary id="{key}-summary" class="min-h-11 cursor-pointer py-2.5 wrap-break-word">
        {item.complete.summary}
      </summary>
      <form
        method="POST"
        action="?/completeBy"
        use:enhance={submit(...afterDone)}
        class="flex flex-col gap-4 pt-2"
      >
        <input type="hidden" name="occurrence" value={item.occurrence} />
        <fieldset
          id="{key}-who"
          tabindex="-1"
          aria-describedby={item.complete.problem ? `${key}-who-problem` : undefined}
          class="flex min-w-0 flex-col"
        >
          <legend class="mb-1 font-semibold">{m['plan.who']()}</legend>
          <FieldProblem id="{key}-who-problem" problem={item.complete.problem ?? undefined} />
          {#each item.complete.choices as choice (choice.id)}
            <!-- The label around the box makes the whole line its target (UI-8). -->
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="doer"
                value={choice.id}
                checked={choice.checked}
                class="size-5 shrink-0 accent-primary"
              />
              <span class="wrap-break-word">{choice.name}</span>
            </label>
          {/each}
        </fieldset>
        <Button type="submit" variant="outline" class="w-full" aria-label={item.complete.label}>
          {m['plan.mark-done-button']()}
        </Button>
      </form>
    </details>
  {/if}
</li>
