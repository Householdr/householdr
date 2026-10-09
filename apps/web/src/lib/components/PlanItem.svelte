<script lang="ts">
  import type { ShownItem } from '#lib/hooks/use-plan.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /** A task in a week's plan: its day, its points for the reader, and why (ADR-0007 §5). */
  let { item }: { item: ShownItem } = $props();
</script>

<li class="flex flex-col gap-2 p-4">
  <span class="font-medium wrap-break-word">{item.task}</span>
  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
    <dt class="text-muted-foreground">{m['plan.day']()}</dt>
    <dd><time datetime={item.date}>{item.day}</time></dd>
    {#if item.points !== null}
      <dt class="text-muted-foreground">{m['plan.points-label']()}</dt>
      <dd>{item.points}</dd>
    {/if}
    <dt class="text-muted-foreground">{m['plan.why']()}</dt>
    <dd class="wrap-break-word">{item.why}</dd>
  </dl>
</li>
