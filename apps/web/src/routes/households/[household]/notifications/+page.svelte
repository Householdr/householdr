<script lang="ts">
  import { page } from '$app/state';
  import PastDay from '#lib/components/PastDay.svelte';
  import { useNotifications } from '#lib/hooks/use-notifications.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const list = useNotifications(() => data);
</script>

<svelte:head>
  <title>{m['notifications.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="notifications" class="text-2xl font-semibold">{m['notifications.title']()}</h1>
  <p class="wrap-break-word">{m['notifications.intro']({ household: data.household })}</p>
  {#if data.flags['notification-preferences']}
    <a href="/notification-settings" class="self-start underline underline-offset-4">
      {m['notifications.settings']()}
    </a>
  {/if}

  {#if list.notifications.length > 0}
    <ul aria-labelledby="notifications" class="flex flex-col divide-y rounded-lg border">
      {#each list.notifications as notification (notification.id)}
        <li class="flex flex-col gap-1 p-4">
          <!-- Each leads to where it can be acted on: every one so far is about a plan (ADR-0014
               §7, clarification). -->
          <a
            href="/households/{page.params.household}/plan"
            class="flex min-h-11 items-center self-start wrap-break-word underline underline-offset-4"
          >
            {notification.said}
          </a>
          <!-- The day only, never the time, as in the activity log (ADR-0018 §3). -->
          <span class="text-sm text-muted-foreground"><PastDay {...notification.day} /></span>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{m['notifications.none']()}</p>
  {/if}

  <a href="/households/{page.params.household}" class="underline underline-offset-4">
    {m['settings.back']()}
  </a>
</main>
