<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { percentage } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { MemberShare, Role } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** A role in words. */
  const roles: Record<Role, () => string> = {
    head: m['household.head'],
    adult: m['household.adult'],
    child: m['household.child'],
  };

  /** A share this week in words, and where it comes from (ADR-0001 §4). */
  const said = (share: MemberShare) => {
    // With the account's culture (ADR-0008 §6, clarification).
    const amount = percentage(share.percent, data.locale);
    if (share.set !== null) return m['shares.set']({ share: amount });
    return share.role === 'child'
      ? m['shares.by-age']({ share: amount })
      : m['shares.default']({ share: amount });
  };

  /** The member whose form came back, if it did. */
  const answered = $derived(form && 'member' in form ? form.member : undefined);
  const refused = $derived(form?.invalid ? answered : undefined);
</script>

<svelte:head>
  <title>{m['shares.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['shares.title']()}</h1>
  <p>{m['shares.intro']()}</p>
  <!-- Shares can reveal illness or disability, so nobody else sees them (ADR-0018 §4). -->
  <p class="text-sm text-muted-foreground">
    {data.mayChange ? m['shares.private-heads']() : m['shares.private']()}
  </p>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.conflict}
      <ErrorSummary
        heading={m['shares.failed']()}
        message={m['shares.conflict']({
          name: form.conflict.name,
          share: percentage(form.conflict.percent, data.locale),
        })}
      />
    {:else if refused}
      <ErrorSummary
        heading={m['shares.failed']()}
        message={m['shares.check']()}
        fields={[{ id: `share-${refused}`, problem: m['shares.invalid'](data.range) }]}
      />
    {/if}
  {/key}

  <p role="status" class="wrap-break-word empty:hidden">
    {form?.saved ? m['shares.saved']({ name: form.saved.name }) : ''}
  </p>

  {#if data.mayChange}
    <p id="share-hint" class="text-sm text-muted-foreground">
      {m['shares.hint']({ min: data.range.min, max: data.range.max })}
    </p>
  {/if}

  <ul aria-label={m['shares.title']()} class="flex flex-col divide-y rounded-lg border">
    {#each data.shares as loaded (loaded.id)}
      <!-- After a conflict, the share as it is now, which the form saves from (ADR-0019 §5). -->
      {@const share = form?.conflict?.id === loaded.id ? form.conflict : loaded}
      {@const here = answered === share.id}
      {@const invalid = refused === share.id}
      <li class="flex flex-col gap-3 p-4">
        <div class="flex flex-col gap-1">
          <span class="font-medium wrap-break-word">
            {share.id === data.you ? m['household.you']({ name: share.name }) : share.name}
          </span>
          <span class="text-sm text-muted-foreground">{roles[share.role]()}</span>
          <span>{said(share)}</span>
        </div>

        {#if data.mayChange}
          <form method="POST" action="?/change" use:enhance class="flex flex-col gap-3">
            <input type="hidden" name="member" value={share.id} />
            <input type="hidden" name="version" value={share.version} />
            <div class="flex flex-col gap-2">
              <Label for="share-{share.id}">{m['shares.field']({ name: share.name })}</Label>
              <Input
                id="share-{share.id}"
                name="percent"
                type="number"
                inputmode="numeric"
                min={data.range.min}
                max={data.range.max}
                step={1}
                required
                class="w-28"
                value={here && form ? form.entered : (share.set ?? '')}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `share-hint share-${share.id}-problem` : 'share-hint'}
              />
              <FieldProblem
                id="share-{share.id}-problem"
                problem={invalid ? m['shares.invalid'](data.range) : undefined}
              />
            </div>
            <div class="flex flex-wrap gap-2">
              <Button type="submit">{m['shares.save']({ name: share.name })}</Button>
              {#if share.set !== null}
                <Button type="submit" name="use" value="default" variant="outline" formnovalidate>
                  {m['shares.use-default']({ name: share.name })}
                </Button>
              {/if}
            </div>
          </form>
        {/if}
      </li>
    {/each}
  </ul>

  <a href="/households/{page.params.household}" class="underline underline-offset-4">
    {m['settings.back']()}
  </a>
</main>
