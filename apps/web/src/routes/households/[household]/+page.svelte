<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { Role } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

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

  {#if data.mayAddMembers}
    <section aria-labelledby="add-adult" class="flex flex-col gap-4">
      <h2 id="add-adult" class="text-lg font-semibold">{m['household.add-adult']()}</h2>
      <p>{m['household.add-adult-intro']()}</p>

      <!-- A new summary for every attempt, so it takes the focus again. -->
      {#key form}
        {#if form?.invalid}
          <ErrorSummary
            heading={m['household.add-failed']()}
            message={m['household.invalid-name']()}
          />
        {/if}
      {/key}

      <!-- Whoever is added is told by the head, not by us (ADR-0012 §9). -->
      <p role="status" class="wrap-break-word empty:hidden">
        {form?.added ? m['household.added']({ name: form.added }) : ''}
      </p>

      <form method="POST" action="?/addAdult" use:enhance class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="name">{m['household.name']()}</Label>
          <Input
            id="name"
            name="name"
            autocomplete="off"
            required
            maxlength={100}
            aria-invalid={form?.invalid ? 'true' : undefined}
            value={form?.name ?? ''}
          />
        </div>
        <Button type="submit" class="w-full">{m['household.add']()}</Button>
      </form>
    </section>
  {/if}

  <a href="/security" class="underline underline-offset-4">{m['security.title']()}</a>
</main>
