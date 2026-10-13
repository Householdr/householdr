<script lang="ts">
  import { dayText, minutesText } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { duenessWords, howOften, onMissWords, windowWords } from '#lib/task-words.js';
  import type { Repeat } from '@householdr/application';
  import type { Dueness, Interval, PlanTask } from '@householdr/domain';

  /**
   * A task in words (ADR-0004 §3, §8): how often, how long and what happens if it isn't done;
   * `full`, with its name and its first time too, as its form has them. A "since last done" task
   * shows how due it is, as a bar from "just done" to "due" and in words, never by the bar alone.
   */
  let {
    task,
    full = false,
    locale,
  }: {
    task: {
      name: string;
      duration: number;
      frequency: Repeat;
      every?: Interval | undefined;
      dueness?: Dueness | undefined;
      /** `YYYY-MM-DD`. */
      start?: string;
      onMiss: PlanTask['onMiss'];
      /** At set times: the window around each date, its times as `HH:MM`. */
      window?:
        | { from: { dayOffset: number; time: string }; to: { dayOffset: number; time: string } }
        | undefined;
    };
    full?: boolean;
    /** The locale values are written in: the page's language, the account's conventions (ADR-0008 §6). */
    locale: string;
  } = $props();

  /** Ties the bar to its label, among the tasks of a list. */
  const uid = $props.id();
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
  {#if full}
    <dt class="text-muted-foreground">{m['tasks.name']()}</dt>
    <dd class="wrap-break-word">{task.name}</dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.how-often']()}</dt>
  <dd>{howOften(task)}</dd>
  {#if task.dueness}
    <dt id="how-due-{uid}" class="text-muted-foreground">{m['tasks.how-due']()}</dt>
    <dd class="flex flex-wrap items-center gap-2">
      <meter aria-labelledby="how-due-{uid}" min={0} max={1} value={task.dueness.progress}></meter>
      <span>{duenessWords(task.dueness)}</span>
    </dd>
  {/if}
  {#if task.window}
    <dt class="text-muted-foreground">{m['tasks.window']()}</dt>
    <dd>{windowWords(task.window)}</dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.how-long']()}</dt>
  <dd>{minutesText(task.duration, locale)}</dd>
  {#if full && task.start}
    <dt class="text-muted-foreground">{m['tasks.start']()}</dt>
    <dd><time datetime={task.start}>{dayText(task.start, locale)}</time></dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.if-not-done']()}</dt>
  <dd>{onMissWords[task.onMiss]()}</dd>
</dl>
