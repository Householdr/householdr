<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { useLeave } from '#lib/hooks/use-leave.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const leave = useLeave(() => data);
  /** The choice the form shows: what was sent when it was refused, "Former member" otherwise. */
  const chosen = $derived(form?.shownAs ?? 'former member');
  /** Who becomes head: what was sent when it was refused, no one in particular otherwise. */
  const successor = $derived(form?.successor ?? '');
</script>

<svelte:head>
  <title>{m['leave.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold wrap-break-word">
    {m['leave.title']({ household: data.household })}
  </h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.problem}
      <ErrorSummary heading={m['leave.failed']()} message={leave.problem(form.problem)} />
    {/if}
  {/key}

  <!-- The last adult with an account is warned that leaving closes the household (ADR-0018 §2). -->
  {#if leave.closes}
    <p class="font-medium">{m['leave.last-adult']()}</p>
  {/if}
  <p>{m['leave.intro']()}</p>
  <p>{m['leave.history']()}</p>
  <p>{m['leave.rejoin']()}</p>
  <form method="POST" use:enhance class="flex flex-col gap-6">
    {#if leave.successors}
      <fieldset class="flex min-w-0 flex-col gap-2">
        <legend class="mb-2 font-semibold">{m['leave.successor']()}</legend>
        <p class="mb-2">{m['leave.last-head']()}</p>
        {#each leave.successors as option (option.value)}
          <label class="flex min-h-11 items-center gap-3">
            <input
              id={option.id}
              type="radio"
              name="successor"
              value={option.value}
              required
              checked={successor === option.value}
              class="size-5 shrink-0 accent-primary"
            />
            <span class="wrap-break-word">{option.label}</span>
          </label>
        {/each}
        <p class="mt-2 text-sm text-muted-foreground">{m['leave.successor-decline']()}</p>
      </fieldset>
    {/if}
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="mb-2 font-semibold">{m['leave.shown-as']()}</legend>
      {#each leave.options as option (option.value)}
        <!-- The label around the radio makes the whole line its target (UI-8). -->
        <label class="flex min-h-11 items-center gap-3">
          <input
            id={option.id}
            type="radio"
            name="shownAs"
            value={option.value}
            required
            checked={chosen === option.value}
            class="size-5 shrink-0 accent-primary"
          />
          <span class="wrap-break-word">{option.label}</span>
        </label>
      {/each}
    </fieldset>
    <Button type="submit" variant="destructive" class="w-full">
      {leave.closes ? m['leave.submit-closes']() : m['leave.submit']()}
    </Button>
  </form>

  <a
    href="/households/{page.params.household}"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['settings.back']()}
  </a>

  <!-- One plain line, without a heading or anything that stands out on a shared screen
       (ADR-0018 §8, clarification). -->
  {#if leave.support}
    <p class="text-sm wrap-break-word text-muted-foreground">
      {leave.support.before}<a
        href={leave.support.href}
        rel="noreferrer"
        class="underline underline-offset-4">{leave.support.site}</a
      >{leave.support.after}
    </p>
  {/if}
</main>
