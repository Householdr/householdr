<script lang="ts">
  import { page } from '$app/state';
  import { dayOf } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /** An entry in words: who did what (ADR-0018 §5), a former member without a name (ADR-0012 §6). */
  const said = (entry: PageProps['data']['entries'][number]) => {
    const actor = entry.actor ?? m['activity.former-member']();
    switch (entry.action) {
      case 'household.name':
        return m['activity.household-name']({ actor });
      case 'household.country':
        return m['activity.household-country']({ actor });
      case 'household.timeZone':
        return m['activity.household-time-zone']({ actor });
      case 'household.language':
        return m['activity.household-language']({ actor });
    }
  };
</script>

<svelte:head>
  <title>{m['activity.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="activity" class="text-2xl font-semibold">{m['activity.title']()}</h1>
  <p>{m['activity.intro']()}</p>

  {#if data.entries.length > 0}
    <ul aria-labelledby="activity" class="flex flex-col divide-y rounded-lg border">
      {#each data.entries as entry (entry.id)}
        <li class="flex flex-col gap-1 p-4">
          <span class="wrap-break-word">{said(entry)}</span>
          <!-- The day only, never the time: when someone is active isn't shared (ADR-0018 §3). -->
          <span class="text-sm text-muted-foreground"
            >{dayOf(entry.at, data.timeZone, data.locale)}</span
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p>{m['activity.none']()}</p>
  {/if}

  <a href="/households/{page.params.household}" class="underline underline-offset-4">
    {m['settings.back']()}
  </a>
</main>
