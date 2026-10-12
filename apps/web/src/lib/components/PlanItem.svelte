<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import PastDay from '#lib/components/PastDay.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import type { ShownItem } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * A task in a week's plan: its day, its points for the reader, and why (ADR-0007 §5); once done,
   * by whom, on which day, and undoing it; while it can be, choosing who did it (ADR-0006 §4). The
   * reader's own task has a box at the end of its name that ticks it done with one tap, or unticks
   * it to undo it.
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
  /** Once it is done: the box, Undo, or what says who did it. Once undone: the box, or the choice. */
  const afterDone = $derived([`${key}-check`, `${key}-undo`, `${key}-done`]);
  const afterUndo = $derived([`${key}-check`, `${key}-summary`]);
</script>

<li class="flex flex-col gap-2 p-4">
  <div class="flex items-start justify-between gap-3">
    <span class="font-medium wrap-break-word">{item.task}</span>
    {#if item.check && submit}
      {@const check = item.check}
      <form
        method="POST"
        action={check.action === 'undo' ? '?/undo' : '?/complete'}
        use:enhance={submit(...(check.action === 'undo' ? afterUndo : afterDone))}
      >
        <input type="hidden" name="occurrence" value={item.occurrence} />
        {#if check.completion}
          <input type="hidden" name="completion" value={check.completion} />
        {/if}
        <!--
          A button announced as a checkbox, as a native one can't send its form without JavaScript
          (CODE-13, UI-5); its visible "Done" starts its name (UI-10). At the end of the line, the
          left in a right-to-left language (UI-17), and 44 px square at least (UI-8). Disabled when
          the reader may not undo it.
        -->
        <button
          id="{key}-check"
          type="submit"
          role="checkbox"
          aria-checked={check.checked}
          aria-label={check.label}
          disabled={check.action === null}
          class="-me-2 -mt-2.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-70"
        >
          {m['plan.done-button']()}
          <span
            aria-hidden="true"
            class={[
              'flex size-5 items-center justify-center rounded border-2',
              check.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
            ]}
          >
            {#if check.checked}
              <svg
                viewBox="0 0 16 16"
                class="size-3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path d="M3 8.5l3.5 3.5L13 4.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            {/if}
          </span>
        </button>
      </form>
    {/if}
  </div>
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
    <p id="{key}-done" tabindex="-1" class="font-medium wrap-break-word">
      {item.done.said.before}<PastDay {...item.done.said.day} />{item.done.said.after}
    </p>
    {#if item.done.loggedBy}
      <p class="text-sm wrap-break-word text-muted-foreground">{item.done.loggedBy}</p>
    {/if}
    {#if item.done.undo && !item.check && submit}
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
