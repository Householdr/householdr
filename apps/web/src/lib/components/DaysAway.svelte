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

  /**
   * Days away as a list and, for whoever manages them, a form to plan more: the household's time
   * away together, or a member's absences (ADR-0005 §2, §5). Only the days, never a reason, a place
   * or anything else (ADR-0018 §3).
   */
  let {
    owner,
    heading,
    intro,
    periods,
    mayManage,
    actions,
    refused,
    status,
    values,
    plannable,
    attempt,
  }: {
    /** Whose days: `household`, or a member's id; the forms send it back as `member`. */
    owner: string;
    heading: string;
    intro?: string;
    periods: { id: string; from: string; to: string }[];
    mayManage: boolean;
    /** The forms' actions, the field that names what is removed, and the words that differ. */
    actions: { add: string; remove: string; removing: string; legend: string; none: string };
    /** The fields the server refused for these days (CODE-13). */
    refused: AbsenceField[];
    /** What the last change did to these days (UI-12). */
    status: string;
    /** What was entered when it was refused, which stays in the form (UI-10). */
    values: Partial<Record<AbsenceField, string>> | undefined;
    /** The days that can be planned, `YYYY-MM-DD`. */
    plannable: { from: string; to: string };
    /** The answer to the last form sent, so a new error summary takes the focus again. */
    attempt: unknown;
  } = $props();

  const absences = useAbsences();
  /** The heading, which takes the focus once a removed period takes its button with it. */
  let headingElement = $state<HTMLElement>();

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
</script>

<h2
  id="away-{owner}"
  tabindex="-1"
  bind:this={headingElement}
  class="text-lg font-semibold wrap-break-word"
>
  {heading}
</h2>
{#if intro}
  <p>{intro}</p>
{/if}
{#if mayManage}
  <p role="status" class="wrap-break-word empty:hidden">{status}</p>
{/if}

<!-- Only the days: never a reason, a place or anything else (ADR-0018 §3). -->
{#if periods.length > 0}
  <ul aria-labelledby="away-{owner}" class="flex flex-col divide-y rounded-lg border">
    {#each periods as period (period.id)}
      <li class="flex flex-wrap items-center justify-between gap-3 p-4">
        <dl id="days-{period.id}" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt class="text-muted-foreground">{m['availability.first-day']()}</dt>
          <dd><time datetime={period.from}>{absences.day(period.from)}</time></dd>
          <dt class="text-muted-foreground">{m['availability.last-day']()}</dt>
          <dd><time datetime={period.to}>{absences.day(period.to)}</time></dd>
        </dl>
        {#if mayManage}
          <form
            method="POST"
            action={actions.remove}
            use:enhance={absences.removeThenFocus(() => headingElement)}
          >
            <input type="hidden" name={actions.removing} value={period.id} />
            <input type="hidden" name="member" value={owner} />
            <Button type="submit" variant="outline" aria-describedby="days-{period.id}">
              {m['availability.remove']()}
            </Button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <p class="text-muted-foreground">{actions.none}</p>
{/if}

{#if mayManage}
  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key attempt}
    {#if refused.length > 0}
      <ErrorSummary
        heading={m['availability.add-failed']()}
        message={m['availability.check']()}
        fields={fields
          .filter((field) => refused.includes(field.name))
          .map((field) => ({ id: `${field.id}-${owner}`, problem: field.problem() }))}
      />
    {/if}
  {/key}

  <form method="POST" action={actions.add} use:enhance class="flex flex-col gap-4">
    <fieldset class="flex min-w-0 flex-col gap-4">
      <legend class="mb-2 font-semibold">{actions.legend}</legend>
      <input type="hidden" name="member" value={owner} />
      {#each fields as field (field.name)}
        {@const id = `${field.id}-${owner}`}
        {@const problem = refused.includes(field.name) ? field.problem() : undefined}
        <div class="flex flex-col gap-2">
          <Label for={id}>{field.label()}</Label>
          <Input
            {id}
            name={field.name}
            type="date"
            required
            min={plannable.from}
            max={plannable.to}
            value={values?.[field.name] ?? ''}
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
