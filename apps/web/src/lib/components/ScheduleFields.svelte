<script lang="ts">
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
  import { useScheduleEditor } from '#lib/hooks/use-schedule-editor.svelte.js';
  import { weekdayName } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import { whichWords } from '#lib/schedule-words.js';
  import { ruleField, ruleKinds, type ScheduleValues } from '#lib/task-schedule.js';
  import type { TaskField } from '@householdr/application';
  import { advancedSchedule, weekdays, weekdaysOfMonth } from '@householdr/domain';

  /**
   * The advanced schedule editor (ADR-0004 §3, clarifications): up to five rules, each of a kind
   * with its own fields and first time, and the extra dates and dates to leave out, showing
   * `values`, with the schedule in words below. Its buttons add or remove a row by sending the
   * form to `action` without saving, so it works without scripts (CODE-10); each leads back to
   * where the change was. Hidden and disabled while it doesn't `apply`, so it is neither checked
   * nor sent.
   */
  let {
    values,
    apply,
    invalid,
    problems,
    today,
    starts,
    dates,
    action,
    locale,
  }: {
    values: ScheduleValues;
    apply: boolean;
    invalid: readonly TaskField[];
    problems: Record<TaskField, () => string>;
    /** `YYYY-MM-DD`: a new rule's first time. */
    today: string;
    starts: { earliest: string; latest: string };
    dates: { earliest: string; latest: string };
    action: string;
    locale: string;
  } = $props();

  const editor = useScheduleEditor(
    () => values,
    () => locale,
  );
  let rulesSet = $state<HTMLFieldSetElement | null>(null);
  $effect(() => (rulesSet ? editor.resetWith(rulesSet) : undefined));

  const kindWords: Record<(typeof ruleKinds)[number], () => string> = {
    weeks: m['schedule.kind-weeks'],
    months: m['schedule.kind-months'],
    'weekdays-of-month': m['schedule.kind-weekdays-of-month'],
    year: m['schedule.kind-year'],
  };

  const problemOf = (field: TaskField) => (invalid.includes(field) ? problems[field]() : undefined);

  /** A group's description: its hint, and its problem if the server refused it (UI-10). */
  const describedBy = (field: TaskField) =>
    [`${field}-hint`, invalid.includes(field) ? `${field}-problem` : ''].filter(Boolean).join(' ');

  /** The kind of a rule as its form shows it, for the server's choice when scripts don't run. */
  const kindOf = (index: number) => values.rules[index]?.kind;

  /** The two lists of dates, with the words of their fields. */
  const dateLists = [
    {
      field: 'extraDates',
      row: 'extra',
      legend: m['schedule.extra-dates'],
      hint: m['schedule.extra-dates-hint'],
      label: m['schedule.extra-date'],
      remove: m['schedule.remove-extra'],
      add: m['schedule.add-extra'],
    },
    {
      field: 'exceptionDates',
      row: 'exception',
      legend: m['schedule.exception-dates'],
      hint: m['schedule.exception-dates-hint'],
      label: m['schedule.exception-date'],
      remove: m['schedule.remove-exception'],
      add: m['schedule.add-exception'],
    },
  ] as const;
</script>

<!-- Every change to a field says the schedule in words again. -->
<fieldset
  bind:this={rulesSet}
  class="flex min-w-0 flex-col gap-4"
  hidden={!apply}
  disabled={!apply}
  aria-describedby={describedBy('rules')}
  oninput={editor.follow}
  onchange={editor.follow}
>
  <legend class="mb-1 text-sm font-medium">{m['schedule.rules']()}</legend>
  <p id="rules-hint" class="text-sm text-muted-foreground">{m['schedule.rules-hint']()}</p>
  {#each values.rules as rule, i (i)}
    {@const number = i + 1}
    <fieldset class="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <legend class="px-1 text-sm font-medium">{m['schedule.rule']({ number })}</legend>
      <div class="flex flex-col gap-2">
        <!-- The summary's link to the rules leads to the first one. -->
        <Label for={i === 0 ? 'rules' : ruleField(i, 'kind')}>{m['schedule.kind']()}</Label>
        <NativeSelect
          id={i === 0 ? 'rules' : ruleField(i, 'kind')}
          name={ruleField(i, 'kind')}
          class="w-full"
          value={kindOf(i)}
          onchange={editor.chooseKind(i)}
          aria-invalid={invalid.includes('rules') || undefined}
        >
          {#each ruleKinds as kind (kind)}
            <NativeSelectOption value={kind}>{kindWords[kind]()}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      {#if editor.applies(i, 'weeks', 'months', 'weekdays-of-month')}
        <div class="flex flex-col gap-2">
          <Label for={ruleField(i, 'every')}>{m['schedule.every']()}</Label>
          <Input
            id={ruleField(i, 'every')}
            name={ruleField(i, 'every')}
            type="number"
            inputmode="numeric"
            min={1}
            step={1}
            class="w-24"
            value={rule.every}
          />
        </div>
      {/if}
      {#if editor.applies(i, 'weeks')}
        <fieldset class="flex min-w-0 flex-col gap-1">
          <legend class="mb-1 text-sm font-medium">{m['schedule.days']()}</legend>
          <div class="flex flex-wrap gap-x-4">
            {#each weekdays as day (day)}
              <label class="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name={ruleField(i, 'days')}
                  value={String(day)}
                  checked={rule.days.includes(String(day))}
                  class="size-5 shrink-0 accent-primary"
                />
                {weekdayName(day, locale)}
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
      {#if editor.applies(i, 'weekdays-of-month')}
        <fieldset class="flex min-w-0 flex-col gap-1">
          <legend class="mb-1 text-sm font-medium">{m['schedule.which']()}</legend>
          <div class="flex flex-wrap gap-x-4">
            {#each weekdaysOfMonth as which (which)}
              <label class="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name={ruleField(i, 'which')}
                  value={String(which)}
                  checked={rule.which.includes(String(which))}
                  class="size-5 shrink-0 accent-primary"
                />
                {whichWords[which]()}
              </label>
            {/each}
          </div>
        </fieldset>
        <div class="flex flex-col gap-2">
          <Label for={ruleField(i, 'day')}>{m['schedule.weekday']()}</Label>
          <NativeSelect id={ruleField(i, 'day')} name={ruleField(i, 'day')} value={rule.day}>
            {#each weekdays as day (day)}
              <NativeSelectOption value={String(day)}>{weekdayName(day, locale)}</NativeSelectOption
              >
            {/each}
          </NativeSelect>
        </div>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for={ruleField(i, 'start')}>{m['schedule.start']()}</Label>
        <Input
          id={ruleField(i, 'start')}
          name={ruleField(i, 'start')}
          type="date"
          required={editor.running}
          min={starts.earliest}
          max={starts.latest}
          class="w-fit"
          value={rule.start || today}
          aria-describedby="{ruleField(i, 'start')}-hint"
        />
        <p id="{ruleField(i, 'start')}-hint" class="text-sm text-muted-foreground">
          {m['schedule.start-hint']()}
        </p>
      </div>
      <!-- Sends the form without saving; leads back to the button that adds a rule. -->
      <Button
        type="submit"
        name="change"
        value="remove-rule-{i}"
        formaction="{action}#{values.rules.length === 1 ? 'rules' : 'add-rule'}"
        formnovalidate
        variant="outline"
        class="self-start"
      >
        {m['schedule.remove-rule']({ number })}
      </Button>
    </fieldset>
  {/each}
  {#if values.rules.length < advancedSchedule.rules}
    <!-- Leads to the new rule. Without rules, the summary's link to them leads here. -->
    <Button
      id={values.rules.length === 0 ? 'rules' : 'add-rule'}
      type="submit"
      name="change"
      value="add-rule"
      formaction="{action}#{ruleField(values.rules.length, 'kind')}"
      formnovalidate
      variant="outline"
      class="self-start"
    >
      {m['schedule.add-rule']()}
    </Button>
  {/if}
  <FieldProblem id="rules-problem" problem={problemOf('rules')} />
</fieldset>
{#each dateLists as list (list.field)}
  <fieldset
    class="flex min-w-0 flex-col gap-3"
    hidden={!apply}
    disabled={!apply}
    aria-describedby={describedBy(list.field)}
    oninput={editor.follow}
    onchange={editor.follow}
  >
    <legend class="mb-1 text-sm font-medium">{list.legend()}</legend>
    <p id="{list.field}-hint" class="text-sm text-muted-foreground">{list.hint()}</p>
    {#each values[list.field] as date, i (i)}
      {@const number = i + 1}
      {@const id = i === 0 ? list.field : `${list.field}-${String(i)}`}
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-2">
          <Label for={id}>{list.label({ number })}</Label>
          <Input
            {id}
            name={list.field}
            type="date"
            min={dates.earliest}
            max={dates.latest}
            class="w-fit"
            value={date}
            aria-invalid={invalid.includes(list.field) || undefined}
          />
        </div>
        <Button
          type="submit"
          name="change"
          value="remove-{list.row}-{i}"
          formaction="{action}#add-{list.row}"
          formnovalidate
          variant="outline"
        >
          {list.remove({ number })}
        </Button>
      </div>
    {/each}
    {#if values[list.field].length < advancedSchedule.dates}
      {@const next = values[list.field].length}
      <Button
        id="add-{list.row}"
        type="submit"
        name="change"
        value="add-{list.row}"
        formaction="{action}#{next === 0 ? list.field : `${list.field}-${String(next)}`}"
        formnovalidate
        variant="outline"
        class="self-start"
      >
        {list.add()}
      </Button>
    {/if}
    <FieldProblem id="{list.field}-problem" problem={problemOf(list.field)} />
  </fieldset>
{/each}
{#if apply && editor.words}
  <p class="text-sm">{m['schedule.in-words']({ words: editor.words })}</p>
{/if}
