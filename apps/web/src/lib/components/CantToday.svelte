<script lang="ts">
  import { enhance } from '$app/forms';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useAbsences } from '#lib/hooks/use-absences.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * "I can't today" for a member (ADR-0005 §3): until which day they can't, which everyone sees,
   * and for whoever manages their availability, saying it with one tap, until the end of today or
   * a later day of the week, and "I can after all". Only its days, never when it was said or why
   * (ADR-0018 §3).
   */
  let {
    owner,
    name,
    self,
    until,
    mayManage,
    days,
    refused,
    locale,
  }: {
    /** The member's id, which the forms send back as `member`. */
    owner: string;
    name: string;
    /** Whether it is the member viewing, who says "I". */
    self: boolean;
    /** The last day they can't, `YYYY-MM-DD`, while it lasts. */
    until: string | null;
    mayManage: boolean;
    /** The days it can last up to, `YYYY-MM-DD`, today first. */
    days: string[];
    /** Whether the server refused the day sent, such as one that has passed since. */
    refused: boolean;
    /** The locale days are written in: the page's language, the account's conventions. */
    locale: string;
  } = $props();

  const absences = useAbsences(() => locale);
  /** The day's field, which takes the focus once "I can after all" takes its button with it. */
  let field = $state<HTMLSelectElement | null>(null);
  const today = $derived(days[0]);
</script>

{#if until}
  <p>
    <!-- Its days only (ADR-0018 §3). -->
    {#if until === today}
      {m['availability.cant-today']()}
    {:else}
      {m['availability.cant-until']({ day: absences.weekDay(until) })}
    {/if}
  </p>
{/if}

{#if mayManage}
  <form
    method="POST"
    action="?/unavailable"
    use:enhance
    class="flex flex-col gap-4 rounded-lg border p-4"
  >
    <fieldset class="flex min-w-0 flex-col gap-4">
      <legend class="mb-2 font-semibold">{m['availability.cant-legend']()}</legend>
      <p>{m['availability.cant-intro']()}</p>
      <input type="hidden" name="member" value={owner} />
      <div class="flex flex-col gap-2">
        <Label for="last-day-{owner}">{m['availability.cant-last-day']()}</Label>
        <NativeSelect
          id="last-day-{owner}"
          name="lastDay"
          bind:ref={field}
          aria-invalid={refused ? 'true' : undefined}
          aria-describedby={refused ? `last-day-${owner}-problem` : undefined}
        >
          {#each days as day (day)}
            <NativeSelectOption value={day}>
              {day === today ? m['availability.cant-today-option']() : absences.weekDay(day)}
            </NativeSelectOption>
          {/each}
        </NativeSelect>
        <FieldProblem
          id="last-day-{owner}-problem"
          problem={refused ? m['availability.cant-invalid-day']() : undefined}
        />
      </div>
    </fieldset>
    <Button type="submit" class="w-full">
      {self ? m['availability.i-cant']() : m['availability.they-cant']({ name })}
    </Button>
  </form>

  {#if until}
    <form
      method="POST"
      action="?/available"
      use:enhance={absences.removeThenFocus(() => field ?? undefined)}
    >
      <input type="hidden" name="member" value={owner} />
      <Button type="submit" variant="outline" class="w-full">
        {self ? m['availability.i-can']() : m['availability.they-can']({ name })}
      </Button>
    </form>
  {/if}
{/if}
