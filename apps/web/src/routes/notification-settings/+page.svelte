<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useNotificationSettings } from '#lib/hooks/use-notification-settings.svelte.js';
  import { usePush, type PushState } from '#lib/hooks/use-push.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PreferencesField } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  /** What the form shows: what was chosen when saving didn't work, the saved preferences otherwise. */
  const values = $derived(form?.values ?? data.preferences);
  // The locale is the account's, which doesn't change while the page is open.
  // svelte-ignore state_referenced_locally
  const settings = useNotificationSettings(data.locale);
  const push = usePush(() => data.push);
  /** Where push stands on this device, in words. */
  const pushSaid: Record<PushState, () => string> = {
    'no-script': m['notification-settings.push-no-script'],
    unsupported: m['notification-settings.push-unsupported'],
    blocked: m['notification-settings.push-blocked'],
    off: m['notification-settings.push-off'],
    on: m['notification-settings.push-on'],
    failed: m['notification-settings.push-failed'],
  };

  /** A field's id on the page, which a summary's link points to. */
  const idOf = (field: PreferencesField) => field.replace('.', '-');
  const invalid = $derived(form?.invalid ?? []);
  const refused = $derived(
    invalid.map((field) => ({ id: idOf(field), problem: settings.problem(field) })),
  );
  const problemOf = (field: PreferencesField) =>
    invalid.includes(field) ? settings.problem(field) : undefined;
  /** A field's own attributes for its hint and its problem, if the server refused it (UI-10). */
  const problemAttributes = (field: PreferencesField, hint?: string) => {
    const refusedHere = invalid.includes(field);
    const describedBy = [hint, refusedHere ? `${idOf(field)}-problem` : undefined].filter(Boolean);
    return {
      'aria-invalid': refusedHere || undefined,
      'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    };
  };
</script>

<svelte:head>
  <title>{m['notification-settings.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['notification-settings.title']()}</h1>
  <p>{m['notification-settings.intro']()}</p>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.conflict}
      {@const current = form.conflict}
      <ErrorSummary
        heading={m['settings.failed']()}
        message={m['notification-settings.conflict']()}
      />
      <!-- The preferences as saved now, to compare with what is still in the form (ADR-0019 §5). -->
      <section aria-labelledby="current" class="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="current" class="font-semibold">{m['settings.current']()}</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {#each settings.categories as category (category.field)}
            <dt>{category.name}</dt>
            <dd>{settings.channelName(current[category.field])}</dd>
          {/each}
          <dt>{m['notification-settings.quiet-hours']()}</dt>
          <dd>
            {m['notification-settings.quiet-hours-now']({
              start: settings.clockTime(current.quietStart),
              end: settings.clockTime(current.quietEnd),
            })}
          </dd>
          <dt>{m['notification-settings.email-fallback']()}</dt>
          <dd>
            {current.emailFallback
              ? m['notification-settings.on']()
              : m['notification-settings.off']()}
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

  <form method="POST" action="?/save" use:enhance class="flex flex-col gap-6">
    <input type="hidden" name="version" value={values.version} />

    <fieldset class="flex flex-col gap-4">
      <legend class="mb-2 text-lg font-semibold">{m['notification-settings.channels']()}</legend>
      {#each settings.categories as category (category.field)}
        <div class="flex flex-col gap-2">
          <Label for={idOf(category.field)}>{category.name}</Label>
          <p id="{idOf(category.field)}-who" class="text-sm text-muted-foreground">
            {category.who}
          </p>
          <NativeSelect
            id={idOf(category.field)}
            name={category.field}
            class="w-full"
            required
            value={values[category.field]}
            {...problemAttributes(category.field, `${idOf(category.field)}-who`)}
          >
            {#each settings.channels as channel (channel.value)}
              <NativeSelectOption value={channel.value}>{channel.name}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <FieldProblem id="{idOf(category.field)}-problem" problem={problemOf(category.field)} />
        </div>
      {/each}
      <!-- Shown as on and locked, with the reason (ADR-0014 §3). -->
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium">{m['notification-settings.security']()}</p>
        <p>{m['notification-settings.security-channel']()}</p>
        <p class="text-sm text-muted-foreground">{m['notification-settings.security-why']()}</p>
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-4" aria-describedby="quiet-hours-hint">
      <legend class="mb-2 text-lg font-semibold">{m['notification-settings.quiet-hours']()}</legend>
      <p id="quiet-hours-hint" class="text-sm text-muted-foreground">
        {m['notification-settings.quiet-hours-hint']()}
      </p>
      <div class="flex flex-wrap gap-4">
        <div class="flex flex-col gap-2">
          <Label for="quietStart">{m['notification-settings.quiet-start']()}</Label>
          <Input
            id="quietStart"
            name="quietStart"
            type="time"
            required
            value={values.quietStart}
            {...problemAttributes('quietStart')}
          />
          <FieldProblem id="quietStart-problem" problem={problemOf('quietStart')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="quietEnd">{m['notification-settings.quiet-end']()}</Label>
          <Input
            id="quietEnd"
            name="quietEnd"
            type="time"
            required
            value={values.quietEnd}
            {...problemAttributes('quietEnd')}
          />
          <FieldProblem id="quietEnd-problem" problem={problemOf('quietEnd')} />
        </div>
      </div>
    </fieldset>

    <div class="flex flex-col gap-1">
      <!-- The label around the box makes the whole sentence its target (UI-8). -->
      <label class="flex min-h-11 items-start gap-3 py-2">
        <input
          id="emailFallback"
          name="emailFallback"
          type="checkbox"
          class="mt-0.5 size-5 shrink-0 accent-primary"
          checked={values.emailFallback}
          {...problemAttributes('emailFallback')}
        />
        {m['notification-settings.email-fallback']()}
      </label>
      <FieldProblem id="emailFallback-problem" problem={problemOf('emailFallback')} />
    </div>

    <Button type="submit" class="w-full">{m['settings.save']()}</Button>
  </form>

  <!-- Turned on and off for the device in hand, apart from the form: it needs JavaScript and the
       browser's permission (ADR-0014 §7, clarification). -->
  <section aria-labelledby="push" class="flex flex-col gap-3 rounded-lg border p-4">
    <h2 id="push" class="text-lg font-semibold">{m['notification-settings.push-title']()}</h2>
    <p>{m['notification-settings.push-intro']()}</p>
    {#if data.push}
      <p role="status">{pushSaid[push.state]()}</p>
      {#if push.state === 'off' || push.state === 'failed'}
        <Button type="button" variant="outline" disabled={push.busy} onclick={push.turnOn}>
          {m['notification-settings.push-turn-on']()}
        </Button>
      {:else if push.state === 'on'}
        <Button type="button" variant="outline" disabled={push.busy} onclick={push.turnOff}>
          {m['notification-settings.push-turn-off']()}
        </Button>
      {/if}
    {:else}
      <p>{m['notification-settings.push-unavailable']()}</p>
    {/if}
  </section>

  <a href="/" class="underline underline-offset-4">{m['notification-settings.back']()}</a>
</main>
