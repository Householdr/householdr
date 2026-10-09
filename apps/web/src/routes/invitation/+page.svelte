<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import InvitationSignUp from '#lib/components/InvitationSignUp.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** Why joining didn't work, in words (CODE-13); an expired link shows as such instead. */
  const problem = $derived.by(() => {
    if (!data.invitation) return undefined;
    if (form?.error === 'member') {
      return m['invitation.member']({ household: data.invitation.household });
    }
    if (form?.error === 'not-allowed') return m['invitation.not-allowed']();
    return undefined;
  });
</script>

<svelte:head>
  <title>{m['invitation.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  {#if data.invitation}
    <h1 class="text-2xl font-semibold wrap-break-word">
      {m['invitation.title']({ household: data.invitation.household })}
    </h1>

    <!-- A new summary for every attempt, so it takes the focus again. -->
    {#key form}
      {#if problem}
        <ErrorSummary heading={m['invitation.failed']()} message={problem} />
      {/if}
    {/key}

    <p class="wrap-break-word">
      {m['invitation.invited']({
        household: data.invitation.household,
        profile: data.invitation.profile,
      })}
    </p>

    {#if data.signedIn}
      <form method="POST" action="?/accept" use:enhance>
        <Button type="submit" class="w-full">{m['invitation.accept']()}</Button>
      </form>
    {:else if data.signUp}
      <InvitationSignUp
        email={data.signUp.email}
        profile={data.invitation.profile}
        languages={data.signUp.languages}
        terms={data.signUp.terms}
      />
    {:else}
      <p>{m['invitation.sign-in-first']()}</p>
      <a
        href="/sign-in?next=invitation"
        class="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        {m['invitation.sign-in']()}
      </a>
      <!-- An account is created by confirming an address first (ADR-0010 §1, clarification); the
           link in that e-mail comes back here. -->
      <p>
        <a href="/sign-up" class="underline">{m['invitation.create-account']()}</a>
      </p>
    {/if}
  {:else}
    <h1 class="text-2xl font-semibold">{m['invitation.title-expired']()}</h1>
    <p>{m['invitation.expired']()}</p>
  {/if}
</main>
