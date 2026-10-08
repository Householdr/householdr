<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<svelte:head>
  <title>{m['forgot.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['forgot.title']()}</h1>
  <p>{m['forgot.intro']()}</p>

  {#key form}
    {#if form?.error}
      <ErrorSummary heading={m['forgot.failed']()} message={m['forgot.invalid']()} />
    {/if}
  {/key}

  <p role="status" class="empty:hidden">
    {form?.sent ? m['forgot.sent']({ email: form.email }) : ''}
  </p>

  <form method="POST" use:enhance class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <Label for="email">{m['forgot.email']()}</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autocomplete="username"
        required
        value={form?.email ?? ''}
      />
    </div>
    <Button type="submit" class="mt-2 w-full">{m['forgot.submit']()}</Button>
  </form>
</main>
