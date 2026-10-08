<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import QrCode from '#lib/components/QrCode.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { useCopy } from '#lib/hooks/use-copy.svelte.js';
  import { useShare } from '#lib/hooks/use-share.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { NewChildProblem, Role } from '@householdr/application';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const clipboard = useCopy();
  const sharing = useShare();

  /** The name of the member `id`, for the messages about their invitation. */
  const nameOf = (id: string) => data.members.find((member) => member.id === id)?.name ?? '';

  /** What the last change to an invitation did, for the status message (UI-12). */
  const invitationStatus = $derived.by(() => {
    if (form?.revoked) return m['household.revoked']({ name: nameOf(form.revoked) });
    if (form?.notInvitable) return m['household.not-invitable']();
    if (form?.link && clipboard.copied === form.link) return m['household.copied']();
    return '';
  });

  /** A role in words. */
  const roles: Record<Role, () => string> = {
    head: m['household.head'],
    adult: m['household.adult'],
    child: m['household.child'],
  };

  /** Why the server refused the child's profile, in words, next to the field it is about. */
  const childProblems: Record<NewChildProblem, { field: string; problem: () => string }> = {
    name: { field: 'child-name', problem: m['household.invalid-name'] },
    birthDate: { field: 'birth-date', problem: m['household.invalid-birth-date'] },
    adult: { field: 'birth-date', problem: m['household.child-is-adult'] },
    consent: { field: 'consent', problem: m['household.invalid-consent'] },
  };
  const refusedChild = $derived(
    (form?.child?.problems ?? []).map((problem) => ({
      id: childProblems[problem].field,
      problem: childProblems[problem].problem(),
    })),
  );
  const childProblemOf = (field: string) => refusedChild.find(({ id }) => id === field)?.problem;

  /** A field's own attributes for its problem, if the server refused it (UI-10). */
  const childProblemAttributes = (field: string) =>
    childProblemOf(field) === undefined
      ? {}
      : { 'aria-invalid': true, 'aria-describedby': `${field}-problem` };
</script>

<svelte:head>
  <title>{m['household.page-title']({ name: data.name })}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold wrap-break-word">{data.name}</h1>

  <section aria-labelledby="members" class="flex flex-col gap-4">
    <h2 id="members" class="text-lg font-semibold">{m['household.members']()}</h2>
    <p role="status" class="wrap-break-word empty:hidden">{invitationStatus}</p>
    <ul aria-labelledby="members" class="flex flex-col divide-y rounded-lg border">
      {#each data.members as member (member.id)}
        <li class="flex flex-col gap-3 p-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium wrap-break-word">
              {member.id === data.you ? m['household.you']({ name: member.name }) : member.name}
            </span>
            <span class="text-sm text-muted-foreground">{roles[member.role]()}</span>
            {#if member.account}
              <!-- Who accepted the invitation, which heads see (ADR-0010 §5). -->
              <span class="text-sm wrap-break-word text-muted-foreground">
                {m['household.joined-as']({
                  name: member.account.name,
                  email: member.account.email,
                })}
              </span>
            {/if}
          </div>

          {#if member.invitable}
            {#if form?.link && form.invited === member.id}
              {@const link = form.link}
              <div class="flex flex-col gap-2">
                <Label for="link-{member.id}">{m['household.link']({ name: member.name })}</Label>
                <Input
                  id="link-{member.id}"
                  readonly
                  value={link}
                  aria-describedby="link-help-{member.id}"
                />
                <p id="link-help-{member.id}" class="text-sm text-muted-foreground">
                  {m['household.link-help']({ name: member.name })}
                </p>
                {#if sharing.supported}
                  <Button
                    type="button"
                    onclick={() =>
                      sharing.share({
                        title: m['household.share-title']({ household: data.name }),
                        text: m['household.share-text']({ household: data.name }),
                        url: link,
                      })}
                  >
                    {m['household.share']()}
                  </Button>
                {/if}
                {#if clipboard.supported}
                  <Button type="button" variant="outline" onclick={() => clipboard.copy(link)}>
                    {m['household.copy']()}
                  </Button>
                {/if}
                <!-- For when both are in the same room (ADR-0010 §5). -->
                <p class="text-sm">{m['household.qr-help']({ name: member.name })}</p>
                {#if form.qr}
                  <QrCode
                    size={form.qr.size}
                    path={form.qr.path}
                    label={m['household.qr']({ name: member.name })}
                  />
                {/if}
              </div>
            {:else if member.invitationDaysLeft !== null}
              <p class="text-sm">
                {m['household.link-out']({ count: member.invitationDaysLeft })}
              </p>
            {/if}
            <div class="flex flex-wrap gap-2">
              <form method="POST" action="?/invite" use:enhance>
                <input type="hidden" name="member" value={member.id} />
                <Button type="submit" variant="outline">
                  {member.invitationDaysLeft === null
                    ? m['household.invite']({ name: member.name })
                    : m['household.new-link']({ name: member.name })}
                </Button>
              </form>
              {#if member.invitationDaysLeft !== null}
                <form method="POST" action="?/revokeInvitation" use:enhance>
                  <input type="hidden" name="member" value={member.id} />
                  <Button type="submit" variant="ghost">
                    {m['household.revoke']({ name: member.name })}
                  </Button>
                </form>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if data.mayAddMembers}
    <section aria-labelledby="add-adult" class="flex flex-col gap-4">
      <h2 id="add-adult" class="text-lg font-semibold">{m['household.add-adult']()}</h2>
      <p>{m['household.add-adult-intro']()}</p>

      <!-- A new summary for every attempt, so it takes the focus again. -->
      {#key form}
        {#if form?.invalid}
          <ErrorSummary
            heading={m['household.add-failed']()}
            message={m['household.invalid-name']()}
          />
        {/if}
      {/key}

      <!-- Whoever is added is told by the head, not by us (ADR-0012 §9). -->
      <p role="status" class="wrap-break-word empty:hidden">
        {form?.added ? m['household.added']({ name: form.added }) : ''}
      </p>

      <form method="POST" action="?/addAdult" use:enhance class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="name">{m['household.name']()}</Label>
          <Input
            id="name"
            name="name"
            autocomplete="off"
            required
            maxlength={100}
            aria-invalid={form?.invalid ? 'true' : undefined}
            value={form?.name ?? ''}
          />
        </div>
        <Button type="submit" class="w-full">{m['household.add']()}</Button>
      </form>
    </section>

    <section aria-labelledby="add-child" class="flex flex-col gap-4">
      <h2 id="add-child" class="text-lg font-semibold">{m['household.add-child']()}</h2>
      <!-- Only someone with parental responsibility consents for a child (ADR-0007 §2, ADR-0010
           §9). -->
      <p>{m['household.add-child-intro']()}</p>

      {#key form}
        {#if form?.child}
          <ErrorSummary
            heading={m['household.add-failed']()}
            message={m['household.check']()}
            fields={refusedChild}
          />
        {/if}
      {/key}

      <p role="status" class="wrap-break-word empty:hidden">
        {form?.addedChild ? m['household.child-added']({ name: form.addedChild }) : ''}
      </p>

      <form method="POST" action="?/addChild" use:enhance class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="child-name">{m['household.name']()}</Label>
          <Input
            id="child-name"
            name="name"
            autocomplete="off"
            required
            maxlength={100}
            value={form?.child?.name ?? ''}
            {...childProblemAttributes('child-name')}
          />
          <FieldProblem id="child-name-problem" problem={childProblemOf('child-name')} />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="birth-date">{m['household.birth-date']()}</Label>
          <Input
            id="birth-date"
            name="birthDate"
            type="date"
            required
            value={form?.child?.birthDate ?? ''}
            {...childProblemAttributes('birth-date')}
          />
          <FieldProblem id="birth-date-problem" problem={childProblemOf('birth-date')} />
        </div>
        <div class="flex flex-col gap-1">
          <!-- Never ticked before the head ticks it (PRIN-14); the label around the box makes the
               whole sentence its target (UI-8). -->
          <label class="flex min-h-11 items-start gap-3 py-2">
            <input
              id="consent"
              name="consent"
              type="checkbox"
              class="mt-0.5 size-5 shrink-0 accent-primary"
              required
              checked={form?.child?.consent ?? false}
              {...childProblemAttributes('consent')}
            />
            {m['household.child-consent']()}
          </label>
          <FieldProblem id="consent-problem" problem={childProblemOf('consent')} />
        </div>
        <Button type="submit" class="w-full">{m['household.add']()}</Button>
      </form>
    </section>
  {/if}

  <a href="/security" class="underline underline-offset-4">{m['security.title']()}</a>
</main>
