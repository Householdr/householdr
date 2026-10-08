<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m['household-setup.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['household-setup.title']()}</h1>

  {#if data.email}
    <p class="wrap-break-word">{m['household-setup.confirmed']({ email: data.email })}</p>
  {:else}
    <p>{m['household-setup.expired']()}</p>
    <p><a href="/sign-up" class="underline">{m['household-setup.ask-again']()}</a></p>
  {/if}
</main>
