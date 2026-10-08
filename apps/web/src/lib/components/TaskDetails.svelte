<script lang="ts">
  import { dayText, minutesText } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import { frequencyWords, onMissWords } from '#lib/task-words.js';
  import type { Frequency, PlanTask } from '@householdr/domain';

  /**
   * A task in words (ADR-0004 §3): how often, how long and what happens if it isn't done; `full`,
   * with its name and its first time too, as its form has them.
   */
  let {
    task,
    full = false,
  }: {
    task: {
      name: string;
      duration: number;
      frequency: Frequency;
      /** `YYYY-MM-DD`. */
      start?: string;
      onMiss: PlanTask['onMiss'];
    };
    full?: boolean;
  } = $props();
  const locale = getLocale();
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
  {#if full}
    <dt class="text-muted-foreground">{m['tasks.name']()}</dt>
    <dd class="wrap-break-word">{task.name}</dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.how-often']()}</dt>
  <dd>{frequencyWords[task.frequency]()}</dd>
  <dt class="text-muted-foreground">{m['tasks.how-long']()}</dt>
  <dd>{minutesText(task.duration, locale)}</dd>
  {#if full && task.start}
    <dt class="text-muted-foreground">{m['tasks.start']()}</dt>
    <dd><time datetime={task.start}>{dayText(task.start, locale)}</time></dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.if-not-done']()}</dt>
  <dd>{onMissWords[task.onMiss]()}</dd>
</dl>
