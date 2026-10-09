<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** The error code of a refused password, in words (CODE-13). */
  const problem = $derived.by(() => {
    if (form?.error === 'too-short') return m['reset.too-short']();
    if (form?.error === 'too-long') return m['reset.too-long']();
    if (form?.error === 'breached') return m['reset.breached']();
    return undefined;
  });
  /** Why the code wasn't taken, in words, when two-factor is on (ADR-0010 §8). */
  const codeProblem = $derived.by(() => {
    if (form?.error === 'needs-code') return m['reset.needs-code']();
    if (form?.error === 'incorrect-code') return m['reset.incorrect-code']();
    return undefined;
  });
  /** After repeated wrong codes, how long until the next try (ADR-0010 §2, clarification). */
  const wait = $derived.by(() => {
    if (form?.error !== 'wait') return undefined;
    const { seconds } = form;
    return seconds < 60
      ? m['reset.wait-seconds']({ count: seconds })
      : m['reset.wait-minutes']({ count: Math.ceil(seconds / 60) });
  });
  const expired = $derived(!data.link || form?.error === 'expired');
  // Also when two-factor was turned on after the page was opened.
  const asksCode = $derived(data.code || codeProblem !== undefined || wait !== undefined);
</script>

<svelte:head>
  <title>{m['reset.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['reset.title']()}</h1>

  {#if expired}
    <p>{m['reset.expired']()}</p>
    <p><a href="/forgot-password" class="underline">{m['reset.ask-again']()}</a></p>
  {:else}
    {#key form}
      {#if problem}
        <ErrorSummary heading={m['reset.failed']()} message={problem} />
      {:else if codeProblem}
        <ErrorSummary
          heading={m['reset.failed']()}
          message={codeProblem}
          fields={[{ id: 'code', problem: codeProblem }]}
        />
      {:else if wait}
        <ErrorSummary heading={m['reset.failed']()} message={wait} />
      {/if}
    {/key}

    <form method="POST" use:enhance class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="password">{m['reset.password']()}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          required
          minlength={12}
          maxlength={128}
          aria-describedby={problem ? 'password-hint password-problem' : 'password-hint'}
          aria-invalid={problem ? true : undefined}
        />
        <p id="password-hint" class="text-sm text-muted-foreground">{m['reset.hint']()}</p>
        {#if problem}
          <p id="password-problem" class="text-sm text-destructive">{problem}</p>
        {/if}
      </div>
      {#if asksCode}
        <!-- One field for either code, told apart by its shape (ADR-0010 §2, §8). -->
        <div class="flex flex-col gap-2">
          <Label for="code">{m['reset.code']()}</Label>
          <Input
            id="code"
            name="code"
            autocomplete="one-time-code"
            autocapitalize="none"
            spellcheck="false"
            required
            aria-invalid={codeProblem ? true : undefined}
            aria-describedby={codeProblem ? 'code-hint code-problem' : 'code-hint'}
          />
          <p id="code-hint" class="text-sm text-muted-foreground">
            {m['sign-in-code.intro']()}
            {m['reset.recovery-code-hint']()}
          </p>
          <FieldProblem id="code-problem" problem={codeProblem} />
        </div>
      {/if}
      <Button type="submit" class="mt-2 w-full">{m['reset.submit']()}</Button>
    </form>
  {/if}
</main>
