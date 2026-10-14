<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m['remove.page-title']({ name: data.name, household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold wrap-break-word">
    {m['remove.title']({ name: data.name })}
  </h1>

  <p>{m['remove.intro']({ name: data.name, household: data.household })}</p>
  <p>{m['remove.history']()}</p>
  {#if data.role === 'child'}
    <!-- A child's account and guardians aren't the household's (ADR-0010 §10). -->
    <p>{m['remove.child']()}</p>
  {/if}
  <p>{m['remove.logged']()}</p>

  {#if data.confirm}
    <!-- Removing a member needs a recent sign-in (ADR-0010 §6). -->
    <p>{m['remove.confirm']()}</p>
    <a href="/security" class="flex min-h-11 items-center self-start underline underline-offset-4">
      {m['remove.confirm-link']()}
    </a>
  {:else}
    <form method="POST" use:enhance class="flex flex-col gap-4">
      <Button type="submit" variant="destructive" class="w-full">
        {m['remove.submit']({ name: data.name })}
      </Button>
    </form>
  {/if}

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['remove.keep']({ name: data.name })}
  </a>
</main>
