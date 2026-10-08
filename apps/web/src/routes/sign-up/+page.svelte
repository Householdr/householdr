<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** The error code of a refused request, in words (CODE-13). */
  const problem = $derived.by(() => {
    if (form?.error === 'invalid') return m['sign-up.invalid']();
    if (form?.error === 'wait') return m['sign-up.wait']();
    return undefined;
  });
</script>

<svelte:head>
  <title>{m['sign-up.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['sign-up.title']()}</h1>
  <p>{m['sign-up.intro']()}</p>

  {#key form}
    {#if problem}
      <ErrorSummary heading={m['sign-up.failed']()} message={problem} />
    {/if}
  {/key}

  <p role="status" class="wrap-break-word empty:hidden">
    {form?.sent ? m['sign-up.sent']({ email: form.email }) : ''}
  </p>

  <form method="POST" use:enhance class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <Label for="email">{m['sign-up.email']()}</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        required
        maxlength={254}
        value={form?.email ?? ''}
      />
    </div>
    <Button type="submit" class="mt-2 w-full">{m['sign-up.submit']()}</Button>
  </form>

  {#if data.flags['sign-in']}
    <p><a href="/sign-in" class="underline">{m['sign-up.have-account']()}</a></p>
  {/if}
</main>
