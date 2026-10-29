<script lang="ts">
  import { page } from '$app/state';
  import MemberBalance from '#lib/components/MemberBalance.svelte';
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
    <MemberBalance balance={member} heading="h2" />
  {/each}

  <!-- Former members' balances, frozen, after the current members' (ADR-0005 §4, clarification). -->
  {#if balances.former.length > 0}
    <section aria-labelledby="former" class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <h2 id="former" class="text-lg font-semibold">{m['balances.former-members']()}</h2>
        <p>{m['balances.former-intro']()}</p>
      </div>
      {#each balances.former as member (member.id)}
        <MemberBalance balance={member} heading="h3" />
      {/each}
    </section>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['settings.back']()}
  </a>
</main>
