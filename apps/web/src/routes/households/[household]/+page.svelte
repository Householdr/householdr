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
  <title>{m['household.page-title']({ name: data.name })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold wrap-break-word">{data.name}</h1>

  <section aria-labelledby="members" class="flex flex-col gap-4">
    <h2 id="members" class="text-lg font-semibold">{m['household.members']()}</h2>
    <ul aria-labelledby="members" class="flex flex-col divide-y rounded-lg border">
      {#each data.members as member (member.id)}
        <li class="flex flex-col gap-1 p-4">
          <span class="font-medium wrap-break-word">
            {member.id === data.you ? m['household.you']({ name: member.name }) : member.name}
          </span>
          <span class="text-sm text-muted-foreground">{roles[member.role]()}</span>
        </li>
      {/each}
    </ul>
  </section>

  <a href="/security" class="underline underline-offset-4">{m['security.title']()}</a>
</main>
