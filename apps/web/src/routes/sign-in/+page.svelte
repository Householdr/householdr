<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { goto } from '$app/navigation';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { usePasskeys } from '#lib/hooks/use-passkeys.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const passkeys = usePasskeys();

  /** Signs in with a passkey, then goes where a password sign-in goes. */
  async function signInWithPasskey() {
    if (await passkeys.sign('/sign-in/passkey')) await goto('/security');
  }

  /** A password sign-in replaces what a passkey's failure said. */
  const signInWithPassword: SubmitFunction = () => {
    passkeys.clear();
  };

  /** The error code of a failed sign-in, in words (CODE-13). */
  const problem = $derived.by(() => {
    if (passkeys.outcome === 'not-signed') return m['sign-in.passkey-failed']();
    if (!form) return undefined;
    if (form.error === 'incorrect') return m['sign-in.incorrect']();
    if (form.error === 'unverified') return m['sign-in.unverified']();
    const seconds = form.seconds ?? 0;
    return seconds < 60
      ? m['sign-in.wait-seconds']({ count: seconds })
      : m['sign-in.wait-minutes']({ count: Math.ceil(seconds / 60) });
  });
</script>

<svelte:head>
  <title>{m['sign-in.title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['sign-in.title']()}</h1>

  {#if data.passwordChanged && !form}
    <p role="status">{m['sign-in.password-changed']()}</p>
  {/if}

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#key passkeys.attempts}
      {#if problem}
        <ErrorSummary heading={m['sign-in.failed']()} message={problem} />
      {/if}
    {/key}
  {/key}

  <!-- Passkeys first, where the browser has them (ADR-0010 §1, ADR-0011 §6). -->
  {#if data.flags.passkeys && passkeys.supported}
    <Button type="button" class="w-full" onclick={signInWithPasskey}>
      {m['sign-in.passkey']()}
    </Button>
    <p class="text-center text-sm text-muted-foreground">{m['sign-in.or-password']()}</p>
  {/if}

  <form method="POST" use:enhance={signInWithPassword} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <Label for="email">{m['sign-in.email']()}</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autocomplete="username"
        required
        value={form?.email ?? ''}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="password">{m['sign-in.password']()}</Label>
      <Input
        id="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
      />
    </div>
    <Button type="submit" class="mt-2 w-full">{m['sign-in.submit']()}</Button>
  </form>

  {#if data.flags['password-reset']}
    <p><a href="/forgot-password" class="underline">{m['sign-in.forgot-password']()}</a></p>
  {/if}
  {#if data.flags.onboarding}
    <p><a href="/sign-up" class="underline">{m['sign-in.create-household']()}</a></p>
  {/if}
</main>
