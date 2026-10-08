<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import type { Role } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /** A role in words. */
  const roles: Record<Role, () => string> = {
    head: m['household.head'],
    adult: m['household.adult'],
    child: m['household.child'],
  };
</script>

<svelte:head>
  <title>{m['home.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['home.title']()}</h1>

  {#if data.households.length > 0}
    <ul class="flex flex-col divide-y rounded-lg border">
      {#each data.households as household (household.id)}
        <li class="flex flex-col gap-1 p-4">
          <a href="/households/{household.id}" class="font-medium underline underline-offset-4">
            {household.name}
          </a>
          <span class="text-sm text-muted-foreground">{roles[household.role]()}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{m['home.none']()}</p>
    <p>{m['home.invitation']()}</p>
  {/if}

  <a href="/security" class="underline underline-offset-4">{m['security.title']()}</a>
</main>
