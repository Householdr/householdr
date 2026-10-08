<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { useAbsences } from '#lib/hooks/use-absences.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { AbsenceField } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const absences = useAbsences();
  /** Each member's heading, by their id, which takes the focus once one of their days is removed. */
  const headings: Record<string, HTMLElement> = {};

  /** The form's fields, in order, each with its label, its problem in words, and its id's start. */
  const fields: { name: AbsenceField; label: () => string; problem: () => string; id: string }[] = [
    {
      name: 'firstDay',
      label: m['availability.first-day'],
      problem: m['availability.invalid-first-day'],
      id: 'first-day',
    },
    {
      name: 'lastDay',
      label: m['availability.last-day'],
      problem: m['availability.invalid-last-day'],
      id: 'last-day',
    },
  ];

  /** The fields the server refused for member `id`'s days (CODE-13). */
  const refusedFor = (id: string) => (form?.member === id ? (form.invalid ?? []) : []);

  /** What the last change did to member `id`'s days, for their status message (UI-12). */
  const statusOf = (id: string) => {
    if (form?.member !== id) return '';
    if (form.done === 'added') return m['availability.added']();
    if (form.done === 'removed') return m['availability.removed']();
    if (form.done === 'already-removed') return m['availability.already-removed']();
    return '';
  };
</script>

<svelte:head>
  <title>{m['availability.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-12">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">{m['availability.title']()}</h1>
    <p>{m['availability.intro']()}</p>
  </div>

  {#each data.members as member (member.id)}
    {@const refused = refusedFor(member.id)}
    <section aria-labelledby="member-{member.id}" class="flex flex-col gap-4">
      <h2
        id="member-{member.id}"
        tabindex="-1"
        bind:this={headings[member.id]}
        class="text-lg font-semibold wrap-break-word"
      >
        {member.id === data.you ? m['household.you']({ name: member.name }) : member.name}
      </h2>
      {#if member.mayManage}
        <p role="status" class="wrap-break-word empty:hidden">{statusOf(member.id)}</p>
      {/if}

      <!-- Only the days: never a reason, a place or anything else (ADR-0018 §3). -->
      {#if member.absences.length > 0}
        <ul aria-labelledby="member-{member.id}" class="flex flex-col divide-y rounded-lg border">
          {#each member.absences as absence (absence.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 p-4">
              <dl id="absence-{absence.id}" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt class="text-muted-foreground">{m['availability.first-day']()}</dt>
                <dd><time datetime={absence.from}>{absences.day(absence.from)}</time></dd>
                <dt class="text-muted-foreground">{m['availability.last-day']()}</dt>
                <dd><time datetime={absence.to}>{absences.day(absence.to)}</time></dd>
              </dl>
              {#if member.mayManage}
                <form
                  method="POST"
                  action="?/remove"
                  use:enhance={absences.removeThenFocus(() => headings[member.id])}
                >
                  <input type="hidden" name="absence" value={absence.id} />
                  <input type="hidden" name="member" value={member.id} />
                  <Button type="submit" variant="outline" aria-describedby="absence-{absence.id}">
                    {m['availability.remove']()}
                  </Button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted-foreground">{m['availability.none']()}</p>
      {/if}

      {#if member.mayManage}
        <!-- A new summary for every attempt, so it takes the focus again. -->
        {#key form}
          {#if refused.length > 0}
            <ErrorSummary
              heading={m['availability.add-failed']()}
              message={m['availability.check']()}
              fields={fields
                .filter((field) => refused.includes(field.name))
                .map((field) => ({ id: `${field.id}-${member.id}`, problem: field.problem() }))}
            />
          {/if}
        {/key}

        <form method="POST" action="?/add" use:enhance class="flex flex-col gap-4">
          <fieldset class="flex min-w-0 flex-col gap-4">
            <legend class="mb-2 font-semibold">{m['availability.plan']()}</legend>
            <input type="hidden" name="member" value={member.id} />
            {#each fields as field (field.name)}
              {@const id = `${field.id}-${member.id}`}
              {@const problem = refused.includes(field.name) ? field.problem() : undefined}
              <div class="flex flex-col gap-2">
                <Label for={id}>{field.label()}</Label>
                <Input
                  {id}
                  name={field.name}
                  type="date"
                  required
                  min={data.plannable.from}
                  max={data.plannable.to}
                  value={form?.member === member.id ? (form[field.name] ?? '') : ''}
                  aria-invalid={problem ? 'true' : undefined}
                  aria-describedby={problem ? `${id}-problem` : undefined}
                />
                <FieldProblem id="{id}-problem" {problem} />
              </div>
            {/each}
          </fieldset>
          <Button type="submit" class="w-full">{m['availability.add']()}</Button>
        </form>
      {/if}
    </section>
  {/each}
</main>
