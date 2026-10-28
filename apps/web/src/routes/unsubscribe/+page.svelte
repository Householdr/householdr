<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>{m['unsubscribe.page-title']()}</title>
</svelte:head>

<!-- What the button does, before anything changes (ADR-0014 §6, clarification). -->
<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['unsubscribe.title']()}</h1>
  {#if form?.done}
    <p role="status">{m['unsubscribe.done']()}</p>
    <a
      href="/notification-settings"
      class="flex min-h-11 items-center self-start underline underline-offset-4"
    >
      {m['unsubscribe.settings']()}
    </a>
  {:else if form?.expired || !data.works}
    <p role="status">{m['unsubscribe.expired']()}</p>
    <a
      href="/notification-settings"
      class="flex min-h-11 items-center self-start underline underline-offset-4"
    >
      {m['unsubscribe.settings']()}
    </a>
  {:else}
    <p>{m['unsubscribe.intro']()}</p>
    <p>{m['unsubscribe.still']()}</p>
    <form method="POST" use:enhance>
      <Button type="submit" class="w-full">{m['unsubscribe.submit']()}</Button>
    </form>
  {/if}
</main>
