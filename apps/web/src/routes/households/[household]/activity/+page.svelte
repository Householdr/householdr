<script lang="ts">
  import { page } from '$app/state';
  import { useActivity } from '#lib/hooks/use-activity.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const activity = useActivity(() => data);
</script>

<svelte:head>
  <title>{m['activity.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="activity" class="text-2xl font-semibold">{m['activity.title']()}</h1>
  <p>{m['activity.intro']()}</p>

  {#if activity.entries.length > 0}
    <ul aria-labelledby="activity" class="flex flex-col divide-y rounded-lg border">
      {#each activity.entries as entry (entry.id)}
        <li class="flex flex-col gap-1 p-4">
          <span class="wrap-break-word">{entry.said}</span>
          {#if entry.detail}
            <span class="wrap-break-word">{entry.detail}</span>
          {/if}
          <!-- The day only, never the time: when someone is active isn't shared (ADR-0018 §3). -->
          <span class="text-sm text-muted-foreground">{entry.day}</span>
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
