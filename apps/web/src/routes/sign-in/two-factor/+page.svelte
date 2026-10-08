<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  /** Why signing in with the code didn't work, in words (CODE-13). */
  const problem = $derived.by(() => {
    if (!form) return undefined;
    if (form.error === 'expired') return m['sign-in-code.expired']();
    if (form.error === 'wait') {
      const { seconds } = form;
      return seconds < 60
        ? m['sign-in.wait-seconds']({ count: seconds })
        : m['sign-in.wait-minutes']({ count: Math.ceil(seconds / 60) });
    }
    return form.field === 'code'
      ? m['sign-in-code.incorrect']()
      : m['sign-in-code.incorrect-recovery']();
  });

  /** The field the server refused, which the summary links to and the field's problem names. */
  const refused = $derived(form?.error === 'incorrect' ? form.field : undefined);
  const fieldId = { code: 'code', recoveryCode: 'recovery-code' } as const;
</script>

<svelte:head>
  <title>{m['sign-in-code.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['sign-in-code.title']()}</h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if problem}
      <ErrorSummary
        heading={m['sign-in.failed']()}
        message={problem}
        fields={refused ? [{ id: fieldId[refused], problem }] : []}
      />
    {/if}
  {/key}

  {#if form?.error === 'expired'}
    <p><a href="/sign-in" class="underline">{m['sign-in-code.start-again']()}</a></p>
  {:else}
    <p id="code-intro">{m['sign-in-code.intro']()}</p>
    <form method="POST" action="?/code" use:enhance class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="code">{m['sign-in-code.code']()}</Label>
        <Input
          id="code"
          name="code"
          autocomplete="one-time-code"
          inputmode="numeric"
          required
          aria-invalid={refused === 'code' || undefined}
          aria-describedby={refused === 'code' ? 'code-intro code-problem' : 'code-intro'}
        />
        <FieldProblem id="code-problem" problem={refused === 'code' ? problem : undefined} />
      </div>
      <Button type="submit" class="mt-2 w-full">{m['sign-in-code.submit']()}</Button>
    </form>

    <!-- For when the app isn't at hand; open after a wrong recovery code (UI-2). -->
    <details open={form?.field === 'recoveryCode'} class="flex flex-col">
      <summary class="cursor-pointer py-2.5 underline">
        {m['sign-in-code.use-recovery-code']()}
      </summary>
      <form method="POST" action="?/recoveryCode" use:enhance class="mt-2 flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="recovery-code">{m['sign-in-code.recovery-code']()}</Label>
          <Input
            id="recovery-code"
            name="recoveryCode"
            autocomplete="one-time-code"
            autocapitalize="none"
            spellcheck="false"
            required
            aria-invalid={refused === 'recoveryCode' || undefined}
            aria-describedby={refused === 'recoveryCode'
              ? 'recovery-code-hint recovery-code-problem'
              : 'recovery-code-hint'}
          />
          <p id="recovery-code-hint" class="text-sm text-muted-foreground">
            {m['sign-in-code.recovery-code-hint']()}
          </p>
          <FieldProblem
            id="recovery-code-problem"
            problem={refused === 'recoveryCode' ? problem : undefined}
          />
        </div>
        <Button type="submit" variant="outline" class="w-full">
          {m['sign-in-code.recovery-submit']()}
        </Button>
      </form>
    </details>

    <p><a href="/sign-in" class="underline">{m['sign-in-code.start-again']()}</a></p>
  {/if}
</main>
