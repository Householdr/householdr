<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useHouseholdSettings } from '#lib/hooks/use-household-settings.svelte.js';
  import { languageName } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { SettingsField } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  /** What the form shows: what was entered when saving didn't work, the saved settings otherwise. */
  const values = $derived(form?.values ?? data.settings);
  // The offered languages are the instance's, and the locale the account's, which don't change
  // while the page is open.
  // svelte-ignore state_referenced_locally
  const settings = useHouseholdSettings(() => values, data.languages, data.locale);

  /** Why the server refused a field, in words (CODE-13). */
  const problems: Record<SettingsField, () => string> = {
    name: m['household-setup.invalid-name'],
    country: m['household-setup.invalid-country'],
    timeZone: m['household-setup.invalid-time-zone'],
    language: m['household-setup.invalid-language'],
  };
  const invalid = $derived(form?.invalid ?? []);
  const refused = $derived(invalid.map((id) => ({ id, problem: problems[id]() })));
  const problemOf = (field: SettingsField) =>
    invalid.includes(field) ? problems[field]() : undefined;
  const problemAttributes = (field: SettingsField, hint?: string) => {
    const refusedHere = invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${field}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };
</script>

<svelte:head>
  <title>{m['settings.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['settings.title']()}</h1>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.conflict}
      <ErrorSummary
        heading={m['settings.failed']()}
        message={form.conflict.changedBy
          ? m['settings.conflict']({ name: form.conflict.changedBy })
          : m['settings.conflict-someone']()}
      />
      <!-- The settings as they are now, to compare with what is still in the form (ADR-0019 §5). -->
      <section aria-labelledby="current" class="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="current" class="font-semibold">{m['settings.current']()}</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>{m['household-setup.household-name']()}</dt>
          <dd class="wrap-break-word">{form.conflict.current.name}</dd>
          <dt>{m['household-setup.country']()}</dt>
          <dd>{settings.countryName(form.conflict.current.country)}</dd>
          <dt>{m['household-setup.time-zone']()}</dt>
          <dd>{settings.timeZoneName(form.conflict.current.timeZone)}</dd>
          <dt>{m['household-setup.language']()}</dt>
          <dd lang={form.conflict.current.language}>
            {languageName(form.conflict.current.language)}
          </dd>
        </dl>
      </section>
    {:else if refused.length > 0}
      <ErrorSummary
        heading={m['settings.failed']()}
        message={m['household-setup.check']()}
        fields={refused}
      />
    {/if}
  {/key}

  <p role="status" class="empty:hidden">{form?.saved ? m['settings.saved']() : ''}</p>

  <form method="POST" action="?/save" use:enhance class="flex flex-col gap-4">
    <input type="hidden" name="version" value={values.version} />
    <div class="flex flex-col gap-2">
      <Label for="name">{m['household-setup.household-name']()}</Label>
      <Input
        id="name"
        name="name"
        autocomplete="off"
        required
        maxlength={100}
        value={values.name}
        {...problemAttributes('name')}
      />
      <FieldProblem id="name-problem" problem={problemOf('name')} />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="country">{m['household-setup.country']()}</Label>
      <NativeSelect
        id="country"
        name="country"
        class="w-full"
        required
        bind:value={() => settings.chosen.country, settings.chooseCountry}
        {...problemAttributes('country', 'country-hint')}
      >
        {#each settings.countryOptions as country (country.code)}
          <NativeSelectOption value={country.code}>{country.name}</NativeSelectOption>
        {/each}
      </NativeSelect>
      <p id="country-hint" class="text-sm text-muted-foreground">{m['settings.country-hint']()}</p>
      <FieldProblem id="country-problem" problem={problemOf('country')} />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="timeZone">{m['household-setup.time-zone']()}</Label>
      <NativeSelect
        id="timeZone"
        name="timeZone"
        class="w-full"
        required
        bind:value={settings.chosen.timeZone}
        {...problemAttributes('timeZone')}
      >
        {#each settings.timeZones as option (option.timeZone)}
          <NativeSelectOption value={option.timeZone}>{option.name}</NativeSelectOption>
        {/each}
      </NativeSelect>
      <FieldProblem id="timeZone-problem" problem={problemOf('timeZone')} />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="language">{m['household-setup.language']()}</Label>
      <NativeSelect
        id="language"
        name="language"
        class="w-full"
        required
        value={values.language}
        {...problemAttributes('language', 'language-hint')}
      >
        {#each settings.languageOptions as language (language.code)}
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
    <p class="text-sm text-muted-foreground">{m['settings.logged']()}</p>
    <Button type="submit" class="w-full">{m['settings.save']()}</Button>
  </form>

  <a href="/households/{page.params.household}" class="underline underline-offset-4">
    {m['settings.back']()}
  </a>
</main>
