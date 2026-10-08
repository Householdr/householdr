<script lang="ts">
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useInvitationSignUp, type JoinField } from '#lib/hooks/use-invitation-sign-up.svelte.js';
  import { m } from '#lib/paraglide/messages.js';

  /**
   * Creating an account to join a household through an invitation (ADR-0010 §1, §5): the address
   * the sign-up link confirmed, the person's name and language, the instance's terms if it has
   * any, and a passkey.
   */
  let {
    email,
    profile,
    languages,
    terms,
  }: { email: string; profile: string; languages: readonly string[]; terms: string | null } =
    $props();
  // The profile and the offered languages don't change while the page is open.
  // svelte-ignore state_referenced_locally
  const join = useInvitationSignUp(profile, languages);
  const fields = join.fields;

  /** Why the server refused a field, in words (CODE-13). */
  const problems: Record<JoinField, () => string> = {
    name: m['invitation.invalid-name'],
    language: m['invitation.invalid-language'],
    terms: m['invitation.invalid-terms'],
  };
  const refused = $derived(join.invalid.map((id) => ({ id, problem: problems[id]() })));
  const problemOf = (field: JoinField) =>
    join.invalid.includes(field) ? problems[field]() : undefined;

  /** A field's own attributes for its problem, if the server refused it (UI-10). */
  const problemAttributes = (field: JoinField) => {
    const refusedHere = join.invalid.includes(field);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': refusedHere ? `${field}-problem` : undefined,
    };
  };

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void join.join();
  }
</script>

{#if join.outcome === 'expired'}
  <!-- The sign-up link stopped working while the form was filled in: a new one starts again. -->
  <ErrorSummary heading={m['invitation.failed']()} message={m['invitation.sign-up-expired']()} />
  <p><a href="/sign-up" class="underline">{m['invitation.ask-again']()}</a></p>
{:else if join.outcome === 'invitation'}
  <ErrorSummary heading={m['invitation.failed']()} message={m['invitation.expired']()} />
{:else}
  <p class="wrap-break-word">{m['invitation.confirmed']({ email })}</p>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key join.attempts}
    {#if join.outcome === 'invalid'}
      <ErrorSummary
        heading={m['invitation.failed']()}
        message={m['invitation.check']()}
        fields={refused}
      />
    {:else if join.outcome === 'not-created'}
      <ErrorSummary heading={m['invitation.failed']()} message={m['invitation.not-created']()} />
    {/if}
  {/key}

  <form method="POST" onsubmit={submit} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <Label for="name">{m['invitation.your-name']()}</Label>
      <Input
        id="name"
        autocomplete="name"
        required
        maxlength={100}
        bind:value={fields.name}
        {...problemAttributes('name')}
      />
      <FieldProblem id="name-problem" problem={problemOf('name')} />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="language">{m['invitation.your-language']()}</Label>
      <NativeSelect
        id="language"
        class="w-full"
        required
        bind:value={fields.language}
        {...problemAttributes('language')}
      >
        {#each join.languageOptions as language (language.code)}
          <NativeSelectOption value={language.code} lang={language.code}>
            {language.name}
          </NativeSelectOption>
        {/each}
      </NativeSelect>
      <FieldProblem id="language-problem" problem={problemOf('language')} />
    </div>
    {#if terms}
      <div class="flex flex-col gap-1">
        <!-- The label around the box makes the whole line its target (UI-8). -->
        <label class="flex min-h-11 items-center gap-3">
          <input
            id="terms"
            type="checkbox"
            class="size-5 shrink-0 accent-primary"
            required
            bind:checked={fields.terms}
            {...problemAttributes('terms')}
          />
          {m['invitation.terms']()}
        </label>
        <a href={terms} target="_blank" rel="noopener noreferrer" class="underline">
          {m['invitation.read-terms']()}
        </a>
        <FieldProblem id="terms-problem" problem={problemOf('terms')} />
      </div>
    {/if}
    <p>{m['invitation.passkey']()}</p>
    <!-- Only a browser that can make the passkey gets the button (PRIN-5); others are told,
         with JavaScript off as well as without passkeys. -->
    {#if join.supported}
      <Button type="submit" class="w-full">{m['invitation.join-with-passkey']()}</Button>
    {:else if join.supported === false}
      <p>{m['invitation.unsupported']()}</p>
    {/if}
    <noscript><p>{m['invitation.unsupported']()}</p></noscript>
  </form>
{/if}
