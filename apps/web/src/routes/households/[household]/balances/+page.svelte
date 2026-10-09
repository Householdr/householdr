<script lang="ts">
  import { page } from '$app/state';
  import { useBalances } from '#lib/hooks/use-balances.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const balances = useBalances(() => data);
</script>

<svelte:head>
  <title>{m['balances.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">{m['balances.title']()}</h1>
    <p>{m['balances.intro']()}</p>
    <p>{m['balances.evening-out']()} {balances.rate}</p>
  </div>

  <!-- Every member sees every balance and its history, never what anyone owed or did (ADR-0002 §6). -->
  {#each balances.members as member (member.id)}
    <section
      aria-labelledby="balance-{member.id}"
      class="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="balance-{member.id}" class="text-lg font-semibold wrap-break-word">
        {member.heading}
      </h2>
      <p class="text-2xl font-semibold tabular-nums">{member.balance}</p>
      {#if member.history.length > 0}
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
            {#each member.history as week (week.start)}
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
  {/each}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['settings.back']()}
  </a>
</main>
