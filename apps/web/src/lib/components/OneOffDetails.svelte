<script lang="ts">
  import { calendarDays, dayText, minutesText } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { onMissWords } from '#lib/task-words.js';
  import type { PlanTask } from '@householdr/domain';

  /**
   * A one-off task in words (ADR-0004 §4): when, within the week of its date or up to its deadline,
   * how long and what happens if it isn't done; `full`, with its name too, as its form has it.
   */
  let {
    oneOff,
    full = false,
    locale,
  }: {
    oneOff: {
      name: string;
      duration: number;
      /** `YYYY-MM-DD`. */
      date: string;
      deadline?: string | undefined;
      onMiss: PlanTask['onMiss'];
    };
    full?: boolean;
    /** The locale values are written in: the page's language, the account's conventions (ADR-0008 §6). */
    locale: string;
  } = $props();
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
  {#if full}
    <dt class="text-muted-foreground">{m['tasks.name']()}</dt>
    <dd class="wrap-break-word">{oneOff.name}</dd>
  {/if}
  <dt class="text-muted-foreground">{m['tasks.one-off-date']()}</dt>
  <dd>
    {#if oneOff.deadline}
      {calendarDays(oneOff.date, oneOff.deadline, locale)}
    {:else}
      {m['tasks.one-off-week']({ day: dayText(oneOff.date, locale) })}
    {/if}
  </dd>
  <dt class="text-muted-foreground">{m['tasks.how-long']()}</dt>
  <dd>{minutesText(oneOff.duration, locale)}</dd>
  <dt class="text-muted-foreground">{m['tasks.if-not-done']()}</dt>
  <dd>{onMissWords[oneOff.onMiss]()}</dd>
</dl>
