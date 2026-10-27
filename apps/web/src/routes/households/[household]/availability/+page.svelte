<script lang="ts">
  import CantToday from '#lib/components/CantToday.svelte';
  import DaysAway from '#lib/components/DaysAway.svelte';
  import { weekDay } from '#lib/intl.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** The fields the server refused for `owner`'s days (CODE-13). */
  const refusedFor = (owner: string) => (form?.member === owner ? (form.invalid ?? []) : []);

  /** What was entered for `owner`'s days when it was refused (UI-10). */
  const valuesOf = (owner: string) => (form?.member === owner && form.invalid ? form : undefined);

  /** What the last change did to `owner`'s days, for their status message (UI-12). */
  const statusOf = (owner: string) => {
    if (form?.member !== owner) return '';
    if (form.done === 'added') return m['availability.added']();
    if (form.done === 'removed') return m['availability.removed']();
    if (form.done === 'already-removed') return m['availability.already-removed']();
    return '';
  };

  /** What the last "I can't" or "I can after all" did for `owner` (UI-12). */
  const cantStatusOf = (owner: string) => {
    if (form?.member !== owner) return '';
    if (form.done === 'cant') return m['availability.cant-reported']();
    if (form.done === 'can') return m['availability.can-again']();
    return '';
  };

  /** Until when `member` can't, in words, the reader as "you" (UI-21). */
  const untilOf = (member: { id: string; unavailableUntil: string | null }) => {
    if (member.unavailableUntil === null) return null;
    const day = weekDay(member.unavailableUntil, data.locale);
    return member.id === data.you
      ? m['availability.you-cant-until']({ day })
      : m['availability.cant-until']({ day });
  };

  /** The days "I can't" can last until, today first, with `member`'s current end chosen. */
  const daysFor = (member: { unavailableUntil: string | null }) =>
    data.cantUntil.map((day, index) => ({
      value: day,
      label: index === 0 ? m['availability.today']() : weekDay(day, data.locale),
      selected: member.unavailableUntil === null ? index === 0 : day === member.unavailableUntil,
    }));
</script>

<svelte:head>
  <title>{m['availability.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-12">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">{m['availability.title']()}</h1>
    <p>{m['availability.intro']()}</p>
  </div>

  <!-- When everyone is away together (ADR-0005 §5), which only heads mark. -->
  <section aria-labelledby="away-household" class="flex flex-col gap-4">
    <DaysAway
      owner="household"
      heading={m['availability.household']()}
      intro={m['availability.household-intro']()}
      periods={data.household.periods}
      mayManage={data.household.mayManage}
      actions={{
        add: '?/addAway',
        remove: '?/removeAway',
        removing: 'period',
        legend: m['availability.household-plan'](),
        none: m['availability.household-none'](),
      }}
      refused={refusedFor('household')}
      status={statusOf('household')}
      values={valuesOf('household')}
      plannable={data.plannable}
      attempt={form}
      locale={data.locale}
    />
  </section>

  {#each data.members as member (member.id)}
    <section aria-labelledby="away-{member.id}" class="flex flex-col gap-4">
      <DaysAway
        owner={member.id}
        heading={member.id === data.you ? m['household.you']({ name: member.name }) : member.name}
        periods={member.absences}
        mayManage={member.mayManage}
        actions={{
          add: '?/add',
          remove: '?/remove',
          removing: 'absence',
          legend: m['availability.plan'](),
          none: m['availability.none'](),
        }}
        refused={refusedFor(member.id)}
        status={statusOf(member.id)}
        values={valuesOf(member.id)}
        plannable={data.plannable}
        attempt={form}
        locale={data.locale}
      />
      {#if data.cantUntil.length > 0}
        <CantToday
          owner={member.id}
          until={untilOf(member)}
          days={daysFor(member)}
          mayManage={member.mayManage}
          status={cantStatusOf(member.id)}
        />
      {/if}
    </section>
  {/each}
</main>
