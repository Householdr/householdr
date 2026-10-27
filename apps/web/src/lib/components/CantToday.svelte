<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * A member's "I can't today" (ADR-0005 §3): while it lasts, the last day it covers, which is all
   * others see of it (ADR-0018 §3); for whoever may manage their availability, the day it lasts
   * until, which reporting it again moves, and "I can after all", which ends it. Never a reason.
   */
  let {
    owner,
    until,
    days,
    mayManage,
    status,
  }: {
    /** The member's id, which the forms send. */
    owner: string;
    /** While it lasts: what says until when, in words. */
    until: string | null;
    /** The days it can last until, with the one chosen first. */
    days: { value: string; label: string; selected: boolean }[];
    mayManage: boolean;
    /** What the last change did, for its status message (UI-12). */
    status: string;
  } = $props();
</script>

{#if until}
  <p id="cant-{owner}" class="font-medium wrap-break-word">{until}</p>
{/if}
{#if mayManage}
  <p role="status" class="wrap-break-word empty:hidden">{status}</p>
  <form method="POST" action="?/cant" use:enhance class="flex flex-col gap-3">
    <input type="hidden" name="member" value={owner} />
    <div class="flex flex-col gap-2">
      <Label for="cant-until-{owner}">{m['availability.cant-until-label']()}</Label>
      <NativeSelect id="cant-until-{owner}" name="lastDay" class="w-full">
        {#each days as day (day.value)}
          <NativeSelectOption value={day.value} selected={day.selected}>
            {day.label}
          </NativeSelectOption>
        {/each}
      </NativeSelect>
    </div>
    <Button type="submit" variant="outline" class="w-full">
      {until ? m['availability.cant-move']() : m['availability.cant']()}
    </Button>
  </form>
  {#if until}
    <form method="POST" action="?/can" use:enhance>
      <input type="hidden" name="member" value={owner} />
      <Button type="submit" variant="outline" class="w-full" aria-describedby="cant-{owner}">
        {m['availability.can-after-all']()}
      </Button>
    </form>
  {/if}
{/if}
