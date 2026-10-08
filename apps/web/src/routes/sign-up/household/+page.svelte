<script lang="ts">
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useHouseholdSetup, type SetupField } from '#lib/hooks/use-household-setup.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  // The offered languages are the instance's, which don't change while the page is open.
  // svelte-ignore state_referenced_locally
  const setup = useHouseholdSetup(data.languages);
  const fields = setup.fields;

  /** Why the server refused a field, in words (CODE-13). */
  const problems: Record<SetupField, () => string> = {
    name: m['household-setup.invalid-name'],
    country: m['household-setup.invalid-country'],
    timeZone: m['household-setup.invalid-time-zone'],
    language: m['household-setup.invalid-language'],
    weekStartDay: m['household-setup.invalid-week-start'],
    headName: m['household-setup.invalid-head-name'],
    headLanguage: m['household-setup.invalid-head-language'],
    adult: m['household-setup.invalid-adult'],
    terms: m['household-setup.invalid-terms'],
  };
  const refused = $derived(setup.invalid.map((id) => ({ id, problem: problems[id]() })));
  const problemOf = (field: SetupField) =>
    setup.invalid.includes(field) ? problems[field]() : undefined;

  /** A field's own attributes for its problem, if the server refused it (UI-10). */
  const problemAttributes = (field: SetupField, hint?: string) => {
    const refusedHere = setup.invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${field}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };

  function create(event: SubmitEvent) {
    event.preventDefault();
    void setup.create();
  }
</script>

<svelte:head>
  <title>{m['household-setup.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['household-setup.title']()}</h1>

  {#if !data.email}
    <p>{m['household-setup.expired']()}</p>
    <p><a href="/sign-up" class="underline">{m['household-setup.ask-again']()}</a></p>
  {:else if setup.outcome === 'expired'}
    <!-- The link stopped working while the form was filled in: a new one starts again. -->
    <ErrorSummary
      heading={m['household-setup.failed']()}
      message={m['household-setup.expired']()}
    />
    <p><a href="/sign-up" class="underline">{m['household-setup.ask-again']()}</a></p>
  {:else}
    <p class="wrap-break-word">{m['household-setup.confirmed']({ email: data.email })}</p>
    <p>{m['household-setup.intro']()}</p>

    <!-- A new summary for every attempt, so it takes the focus again. -->
    {#key setup.attempts}
      {#if setup.outcome === 'invalid'}
        <ErrorSummary
          heading={m['household-setup.failed']()}
          message={m['household-setup.check']()}
          fields={refused}
        />
      {:else if setup.outcome === 'not-created'}
        <ErrorSummary
          heading={m['household-setup.failed']()}
          message={m['household-setup.not-created']()}
        />
      {/if}
    {/key}

    <form method="POST" onsubmit={create} class="flex flex-col gap-8">
      <fieldset class="flex min-w-0 flex-col gap-4">
        <legend class="mb-4 text-lg font-semibold">{m['household-setup.household']()}</legend>
        <div class="flex flex-col gap-2">
          <Label for="name">{m['household-setup.household-name']()}</Label>
          <Input
            id="name"
            autocomplete="off"
            required
            maxlength={100}
            bind:value={fields.name}
            {...problemAttributes('name')}
          />
          <FieldProblem id="name-problem" problem={problemOf('name')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="country">{m['household-setup.country']()}</Label>
          <NativeSelect
            id="country"
            class="w-full"
            required
            bind:value={() => fields.country, setup.chooseCountry}
            {...problemAttributes('country')}
          >
            <NativeSelectOption value="">{m['household-setup.choose-country']()}</NativeSelectOption
            >
            {#each setup.countryOptions as country (country.code)}
              <NativeSelectOption value={country.code}>{country.name}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <FieldProblem id="country-problem" problem={problemOf('country')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="timeZone">{m['household-setup.time-zone']()}</Label>
          <NativeSelect
            id="timeZone"
            class="w-full"
            required
            disabled={setup.timeZones.length === 0}
            bind:value={fields.timeZone}
            {...problemAttributes('timeZone')}
          >
            {#each setup.timeZones as timeZone (timeZone)}
              <NativeSelectOption value={timeZone}
                >{timeZone.replaceAll('_', ' ')}</NativeSelectOption
              >
            {/each}
          </NativeSelect>
          <FieldProblem id="timeZone-problem" problem={problemOf('timeZone')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="language">{m['household-setup.language']()}</Label>
          <NativeSelect
            id="language"
            class="w-full"
            required
            bind:value={fields.language}
            {...problemAttributes('language', 'language-hint')}
          >
            {#each setup.languageOptions as language (language.code)}
              <NativeSelectOption value={language.code} lang={language.code}>
                {language.name}
              </NativeSelectOption>
            {/each}
          </NativeSelect>
          <p id="language-hint" class="text-sm text-muted-foreground">
            {m['household-setup.language-hint']()}
          </p>
          <FieldProblem id="language-problem" problem={problemOf('language')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="weekStartDay">{m['household-setup.week-start']()}</Label>
          <NativeSelect
            id="weekStartDay"
            class="w-full"
            required
            bind:value={fields.weekStartDay}
            {...problemAttributes('weekStartDay')}
          >
            {#each setup.weekdays as weekday (weekday.day)}
              <NativeSelectOption value={String(weekday.day)}>{weekday.name}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <FieldProblem id="weekStartDay-problem" problem={problemOf('weekStartDay')} />
        </div>
      </fieldset>

      <fieldset class="flex min-w-0 flex-col gap-4">
        <legend class="mb-4 text-lg font-semibold">{m['household-setup.you']()}</legend>
        <div class="flex flex-col gap-2">
          <Label for="headName">{m['household-setup.your-name']()}</Label>
          <Input
            id="headName"
            autocomplete="name"
            required
            maxlength={100}
            bind:value={fields.headName}
            {...problemAttributes('headName')}
          />
          <FieldProblem id="headName-problem" problem={problemOf('headName')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="headLanguage">{m['household-setup.your-language']()}</Label>
          <NativeSelect
            id="headLanguage"
            class="w-full"
            required
            bind:value={fields.headLanguage}
            {...problemAttributes('headLanguage')}
          >
            {#each setup.languageOptions as language (language.code)}
              <NativeSelectOption value={language.code} lang={language.code}>
                {language.name}
              </NativeSelectOption>
            {/each}
          </NativeSelect>
          <FieldProblem id="headLanguage-problem" problem={problemOf('headLanguage')} />
        </div>
        <div class="flex flex-col gap-1">
          <!-- The label around the box makes the whole line its target (UI-8). -->
          <label class="flex min-h-11 items-center gap-3">
            <input
              id="adult"
              type="checkbox"
              class="size-5 shrink-0 accent-primary"
              required
              bind:checked={fields.adult}
              {...problemAttributes('adult')}
            />
            {m['household-setup.adult']()}
          </label>
          <FieldProblem id="adult-problem" problem={problemOf('adult')} />
        </div>
        {#if data.terms}
          <div class="flex flex-col gap-1">
            <label class="flex min-h-11 items-center gap-3">
              <input
                id="terms"
                type="checkbox"
                class="size-5 shrink-0 accent-primary"
                required
                bind:checked={fields.terms}
                {...problemAttributes('terms')}
              />
              {m['household-setup.terms']()}
            </label>
            <a href={data.terms} target="_blank" rel="noopener noreferrer" class="underline">
              {m['household-setup.read-terms']()}
            </a>
            <FieldProblem id="terms-problem" problem={problemOf('terms')} />
          </div>
        {/if}
      </fieldset>

      <div class="flex flex-col gap-4">
        <p>{m['household-setup.passkey']()}</p>
        <!-- Only a browser that can make the passkey gets the button (PRIN-5); others are told,
             with JavaScript off as well as without passkeys. -->
        {#if setup.supported}
          <Button type="submit" class="w-full">{m['household-setup.create']()}</Button>
        {:else if setup.supported === false}
          <p>{m['household-setup.unsupported']()}</p>
        {/if}
        <noscript><p>{m['household-setup.unsupported']()}</p></noscript>
      </div>
    </form>
  {/if}
</main>
