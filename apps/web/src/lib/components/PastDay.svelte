<!--
  A past day said vaguely, such as “Last week”, with the exact day in a tooltip that opens on hover,
  on keyboard focus and on a tap (ADR-0008 §6, clarification). A day said exactly needs none.
-->
<script lang="ts">
  import { Tooltip } from 'bits-ui';

  interface Props {
    /** The day in words, vague or exact. */
    said: string;
    /** The exact day, such as “Monday 5 October 2026”. */
    exact: string;
    /** The day as `YYYY-MM-DD`. */
    datetime: string;
  }

  let { said, exact, datetime }: Props = $props();

  let open = $state(false);
  /** Whether the press on the trigger is a touch, which opens no tooltip by itself. */
  let touch = false;
</script>

{#if said === exact}
  <time {datetime}>{said}</time>
{:else}
  <Tooltip.Provider delayDuration={300}>
    <!-- A click doesn't close it, so a tap can toggle it. -->
    <Tooltip.Root bind:open disableCloseOnTriggerClick>
      <!-- At least 44 × 44 px to press (UI-8), without moving the text around it. -->
      <Tooltip.Trigger
        type="button"
        class="relative cursor-help rounded-sm underline decoration-dotted underline-offset-4 outline-none before:absolute before:top-1/2 before:left-1/2 before:h-11 before:w-[max(100%,2.75rem)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:ring-3 focus-visible:ring-ring"
        onpointerdown={(event: PointerEvent) => {
          touch = event.pointerType === 'touch';
        }}
        onclick={() => {
          if (touch) open = !open;
        }}
      >
        <time {datetime}>{said}</time>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={4}
          class="z-50 rounded-md bg-foreground px-3 py-1.5 text-sm text-balance text-background"
        >
          {exact}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
