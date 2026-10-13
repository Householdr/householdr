<script lang="ts">
  import type { ShownBalance } from '#lib/hooks/use-balances.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * A member's balance and its history, in words (ADR-0002 §6), under a heading of the level the
   * page needs.
   */
  let { balance, heading }: { balance: ShownBalance; heading: 'h2' | 'h3' } = $props();
</script>

<section aria-labelledby="balance-{balance.id}" class="flex flex-col gap-3 rounded-lg border p-4">
  <svelte:element
    this={heading}
    id="balance-{balance.id}"
    class="text-lg font-semibold wrap-break-word"
  >
    {balance.heading}
  </svelte:element>
  <p class="text-2xl font-semibold tabular-nums">{balance.balance}</p>
  {#if balance.history.length > 0}
    <table class="w-full">
      <caption class="pb-2 text-start text-sm text-muted-foreground">
        {m['balances.history']()}
      </caption>
      <thead>
        <tr>
          <th scope="col" class="py-2 text-start font-medium">{m['balances.week']()}</th>
          <th scope="col" class="py-2 text-end font-medium">{m['balances.change']()}</th>
        </tr>
      </thead>
      <tbody>
        {#each balance.history as week (week.start)}
          <tr class="border-t">
            <td class="py-2 pe-4"><time datetime={week.start}>{week.week}</time></td>
            <td class="py-2 text-end whitespace-nowrap tabular-nums">{week.change}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="text-muted-foreground">{m['balances.no-history']()}</p>
  {/if}
</section>
