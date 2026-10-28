<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  /** The id of the name field a refusal is about: an area's, or the new one's. */
  const refusedId = $derived(form?.problem ? (form.areaId ? `area-${form.areaId}` : 'name') : '');
  const problem = $derived(
    form?.problem === 'taken' ? m['areas.taken']() : form?.problem ? m['areas.invalid']() : '',
  );

  /** What the status says after a change. */
  const status = $derived(
    form?.added
      ? m['areas.added']({ name: form.added })
      : form?.renamed
        ? m['areas.renamed']({ name: form.renamed })
        : form?.removed
          ? m['areas.removed']({ name: form.removed })
          : '',
  );

  /** A name field's own attributes for its problem, if the server refused it (UI-10). */
  const described = (id: string) =>
    refusedId === id ? { 'aria-invalid': true, 'aria-describedby': `${id}-problem` } : {};
</script>

<svelte:head>
  <title>{m['areas.page-title']({ household: data.household })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 id="areas" class="text-2xl font-semibold">{m['areas.title']()}</h1>
  <p>{m['areas.intro']()}</p>

  <!-- A new summary for every attempt, so it takes the focus again. -->
  {#key form}
    {#if form?.problem}
      <ErrorSummary
        heading={m['areas.failed']()}
        message={m['tasks.check']()}
        fields={[{ id: refusedId, problem }]}
      />
    {/if}
  {/key}

  <p role="status" class="wrap-break-word empty:hidden">{status}</p>

  {#if data.areas.length === 0}
    <p>{m['areas.none']()}</p>
  {:else if !data.mayChange}
    <ul aria-labelledby="areas" class="flex flex-col divide-y rounded-lg border">
      {#each data.areas as area (area.id)}
        <li class="p-4 wrap-break-word">{area.name}</li>
      {/each}
    </ul>
  {:else}
    <ul aria-labelledby="areas" class="flex flex-col divide-y rounded-lg border">
      {#each data.areas as area (area.id)}
        {@const id = `area-${area.id}`}
        <li class="flex flex-col gap-3 p-4">
          <form method="POST" action="?/rename" use:enhance class="flex flex-col gap-2">
            <input type="hidden" name="areaId" value={area.id} />
            <Label for={id} class="wrap-break-word">{area.name}</Label>
            <Input
              {id}
              name="name"
              required
              maxlength={50}
              autocomplete="off"
              value={refusedId === id ? form?.name : area.name}
              {...described(id)}
            />
            <FieldProblem id="{id}-problem" problem={refusedId === id ? problem : undefined} />
            <Button type="submit" variant="outline" class="self-start">
              {m['areas.rename']({ name: area.name })}
            </Button>
          </form>
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="areaId" value={area.id} />
            <Button type="submit" variant="outline">{m['areas.remove']({ name: area.name })}</Button
            >
          </form>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.mayChange}
    <section aria-labelledby="add-area" class="flex flex-col gap-4">
      <h2 id="add-area" class="text-lg font-semibold">{m['areas.add']()}</h2>
      <form method="POST" action="?/add" use:enhance class="flex flex-col gap-2">
        <Label for="name">{m['areas.name']()}</Label>
        <Input
          id="name"
          name="name"
          required
          maxlength={50}
          autocomplete="off"
          value={refusedId === 'name' ? form?.name : ''}
          {...described('name')}
        />
        <FieldProblem id="name-problem" problem={refusedId === 'name' ? problem : undefined} />
        <Button type="submit" class="w-full">{m['areas.add']()}</Button>
      </form>
    </section>
  {/if}

  <a
    href="/households/{page.params.household}/tasks"
    class="flex min-h-11 items-center self-start underline underline-offset-4"
  >
    {m['areas.back']()}
  </a>
</main>
