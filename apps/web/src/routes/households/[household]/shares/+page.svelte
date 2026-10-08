<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { calendarDay, calendarDays, percentage } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import type { MemberShare, Role, TemporaryShareField } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const locale = getLocale();

  /** A role in words. */
  const roles: Record<Role, () => string> = {
    head: m['household.head'],
    adult: m['household.adult'],
    child: m['household.child'],
  };

  /** A share this week in words, and where it comes from (ADR-0001 §4). */
  const said = (share: MemberShare) => {
    const amount = percentage(share.percent, locale);
    if (share.temporaryThisWeek) return m['shares.temporary-this-week']({ share: amount });
    if (share.set !== null) return m['shares.set']({ share: amount });
    return share.role === 'child'
      ? m['shares.by-age']({ share: amount })
      : m['shares.default']({ share: amount });
  };

  /** The member whose form came back, if it did. */
  const answered = $derived(form && 'member' in form ? form.member : undefined);
  const refused = $derived(form?.invalid ? answered : undefined);

  /** A temporary share's percent and days in words. */
  const temporaryWords = (planned: { percent: number; firstDay: string; lastDay: string }) => ({
    share: percentage(planned.percent, locale),
    days: calendarDays(planned.firstDay, planned.lastDay, locale),
  });

  /** The temporary share form that came back, if one did, and why. */
  const temporary = $derived(form?.temporary);
  const temporaryProblems: Record<TemporaryShareField, () => string> = {
    firstDay: () =>
      m['shares.invalid-first-day']({
        earliest: calendarDay(data.temporaryDays.earliest, locale),
        latest: calendarDay(data.temporaryDays.latest, locale),
      }),
    lastDay: () =>
      m['shares.invalid-last-day']({ latest: calendarDay(data.temporaryDays.latest, locale) }),
    percent: () => m['shares.invalid'](data.range),
  };
  const temporaryProblemOf = (member: string, field: TemporaryShareField) =>
    temporary?.member === member && temporary.invalid.includes(field)
      ? temporaryProblems[field]()
      : undefined;
  /** A temporary share field's own attributes for its problem, if the server refused it (UI-10). */
  const temporaryAttributes = (member: string, field: TemporaryShareField, hint?: string) => {
    const problem = temporaryProblemOf(member, field) !== undefined;
    const describedBy = [hint, problem ? `temporary-${member}-${field}-problem` : undefined];
    return {
      'aria-invalid': problem || undefined,
      'aria-describedby': describedBy.filter(Boolean).join(' ') || undefined,
    };
  };
  const nameOf = (member: string) => data.shares.find(({ id }) => id === member)?.name ?? '';

  /** What the status says after a change was saved. */
  const status = $derived.by(() => {
    if (form?.saved) return m['shares.saved']({ name: form.saved.name });
    if (form?.added) return m['shares.added-temporary']({ name: form.added.name });
    if (form?.removed) return m['shares.removed-temporary']({ name: form.removed.name });
    return '';
  });
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
          share: percentage(form.conflict.percent, locale),
        })}
      />
    {:else if refused}
      <ErrorSummary
        heading={m['shares.failed']()}
        message={m['shares.check']()}
        fields={[{ id: `share-${refused}`, problem: m['shares.invalid'](data.range) }]}
      />
    {:else if temporary?.overlapping}
      <ErrorSummary
        heading={m['shares.failed']()}
        message={m['shares.overlap']({
          name: nameOf(temporary.member),
          ...temporaryWords(temporary.overlapping),
        })}
        fields={[
          {
            id: `temporary-${temporary.member}-firstDay`,
            problem: m['shares.overlap-days']({
              days: temporaryWords(temporary.overlapping).days,
            }),
          },
        ]}
      />
    {:else if temporary && temporary.invalid.length > 0}
      {@const member = temporary.member}
      <ErrorSummary
        heading={m['shares.failed']()}
        message={m['shares.check-temporary']()}
        fields={temporary.invalid.map((field) => ({
          id: `temporary-${member}-${field}`,
          problem: temporaryProblems[field](),
        }))}
      />
    {/if}
  {/key}

  <p role="status" class="wrap-break-word empty:hidden">{status}</p>

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

        {#if share.temporary.length > 0}
          <ul
            aria-label={m['shares.temporary-list']({ name: share.name })}
            class="flex flex-col gap-2"
          >
            {#each share.temporary as planned (planned.id)}
              {@const words = temporaryWords(planned)}
              <li class="flex flex-wrap items-center justify-between gap-2">
                <span>{m['shares.temporary']({ ...words })}</span>
                {#if data.mayChange}
                  <form method="POST" action="?/removeTemporary" use:enhance>
                    <input type="hidden" name="id" value={planned.id} />
                    <Button type="submit" variant="outline">
                      {m['shares.remove-temporary']({ name: share.name, ...words })}
                    </Button>
                  </form>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if data.mayChange}
          {@const kept = temporary?.member === share.id ? temporary.values : undefined}
          {@const prefix = `temporary-${share.id}`}
          <details open={kept !== undefined || undefined} class="flex flex-col gap-3">
            <summary class="min-h-11 cursor-pointer content-center underline underline-offset-4">
              {m['shares.add-temporary']({ name: share.name })}
            </summary>
            <form
              method="POST"
              action="?/addTemporary"
              use:enhance
              class="mt-3 flex flex-col gap-3"
            >
              <input type="hidden" name="member" value={share.id} />
              <p id="{prefix}-hint" class="text-sm text-muted-foreground">
                {m['shares.temporary-hint']()}
              </p>
              <div class="flex flex-wrap gap-3">
                <div class="flex flex-col gap-2">
                  <Label for="{prefix}-firstDay">{m['shares.first-day']()}</Label>
                  <Input
                    id="{prefix}-firstDay"
                    name="firstDay"
                    type="date"
                    required
                    min={data.temporaryDays.earliest}
                    max={data.temporaryDays.latest}
                    value={kept?.firstDay ?? ''}
                    {...temporaryAttributes(share.id, 'firstDay', `${prefix}-hint`)}
                  />
                  <FieldProblem
                    id="{prefix}-firstDay-problem"
                    problem={temporaryProblemOf(share.id, 'firstDay')}
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <Label for="{prefix}-lastDay">{m['shares.last-day']()}</Label>
                  <Input
                    id="{prefix}-lastDay"
                    name="lastDay"
                    type="date"
                    required
                    min={data.temporaryDays.earliest}
                    max={data.temporaryDays.latest}
                    value={kept?.lastDay ?? ''}
                    {...temporaryAttributes(share.id, 'lastDay', `${prefix}-hint`)}
                  />
                  <FieldProblem
                    id="{prefix}-lastDay-problem"
                    problem={temporaryProblemOf(share.id, 'lastDay')}
                  />
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Label for="{prefix}-percent">{m['shares.temporary-field']()}</Label>
                <Input
                  id="{prefix}-percent"
                  name="percent"
                  type="number"
                  inputmode="numeric"
                  min={data.range.min}
                  max={data.range.max}
                  step={1}
                  required
                  class="w-28"
                  value={kept?.percent ?? ''}
                  {...temporaryAttributes(share.id, 'percent', 'share-hint')}
                />
                <FieldProblem
                  id="{prefix}-percent-problem"
                  problem={temporaryProblemOf(share.id, 'percent')}
                />
              </div>
              <Button type="submit" class="self-start">
                {m['shares.add-temporary-button']({ name: share.name })}
              </Button>
            </form>
          </details>
        {/if}
      </li>
    {/each}
  </ul>

  <a href="/households/{page.params.household}" class="underline underline-offset-4">
    {m['settings.back']()}
  </a>
</main>
