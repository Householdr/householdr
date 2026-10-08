<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { usePasskeys } from '#lib/hooks/use-passkeys.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let heading = $state<HTMLElement>();
  let passkeysHeading = $state<HTMLElement>();
  const passkeys = usePasskeys();

  /** A device by its browser and system, as far as they are known. */
  const name = ({ browser, system }: { browser: string | null; system: string | null }) =>
    browser || system
      ? m['security.device']({
          browser: browser ?? m['security.unknown-browser'](),
          system: system ?? m['security.unknown-system'](),
        })
      : m['security.unknown-device']();

  const lastUsed = (days: number) =>
    days < 1 ? m['security.used-today']() : m['security.used-days']({ count: days });

  const added = (days: number) =>
    days < 1 ? m['security.added-today']() : m['security.added-days']({ count: days });

  /** What the last change did, for the status message (UI-12). */
  const status = $derived.by(() => {
    if (form?.done === 'signed-out') return m['security.signed-out']();
    if (form?.done === 'signed-out-others') return m['security.signed-out-others']();
    if (form?.done === 'not-found') return m['security.not-found']();
    return '';
  });

  /** What the last change to the passkeys did, for their status message (UI-12). */
  const passkeysStatus = $derived.by(() => {
    if (passkeys.outcome === 'added') return m['security.passkey-added']();
    if (passkeys.outcome === 'failed') return m['security.passkey-failed']();
    if (form?.done === 'passkey-removed') return m['security.passkey-removed']();
    if (form?.done === 'passkey-not-found') return m['security.passkey-not-found']();
    if (data.confirmed && data.passkeys?.changeable) return m['security.confirmed']();
    return '';
  });

  /** Why confirming it's you didn't work, in words (CODE-13). */
  const confirmProblem = $derived.by(() => {
    if (!form?.confirm) return undefined;
    if (form.confirm !== 'wait') return m['security.incorrect-password']();
    const { seconds } = form;
    return seconds < 60
      ? m['sign-in.wait-seconds']({ count: seconds })
      : m['sign-in.wait-minutes']({ count: Math.ceil(seconds / 60) });
  });

  // The button that was pressed leaves with its device or passkey, so the focus goes to the
  // list's heading rather than to the top of the page.
  const keepFocusOn =
    (target: () => HTMLElement | undefined): SubmitFunction =>
    () =>
    async ({ update }) => {
      passkeys.clear();
      await update();
      target()?.focus();
    };
  const keepFocus = keepFocusOn(() => heading);
</script>

<svelte:head>
  <title>{m['security.page-title']()}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
  <h1 class="text-2xl font-semibold">{m['security.title']()}</h1>

  <section aria-labelledby="devices" class="flex flex-col gap-4">
    <h2 id="devices" tabindex="-1" bind:this={heading} class="text-lg font-semibold">
      {m['security.devices']()}
    </h2>
    <ul aria-labelledby="devices" class="flex flex-col divide-y rounded-lg border">
      {#each data.devices as device (device.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 p-4">
          <div id="device-{device.id}">
            <p class="font-medium">{name(device)}</p>
            <p class="text-sm text-muted-foreground">
              {device.current ? m['security.this-device']() : lastUsed(device.daysSinceUse)}
            </p>
          </div>
          {#if device.current}
            <form method="POST" action="?/signOut" use:enhance>
              <Button type="submit" variant="outline" aria-describedby="device-{device.id}">
                {m['security.sign-out']()}
              </Button>
            </form>
          {:else}
            <form method="POST" action="?/signOutDevice" use:enhance={keepFocus}>
              <input type="hidden" name="session" value={device.id} />
              <Button type="submit" variant="outline" aria-describedby="device-{device.id}">
                {m['security.sign-out']()}
              </Button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    {#if data.devices.some((device) => !device.current)}
      <form method="POST" action="?/signOutOthers" use:enhance={keepFocus}>
        <Button type="submit" variant="outline">{m['security.sign-out-others']()}</Button>
      </form>
    {/if}
    <p role="status">{status}</p>
  </section>

  {#if data.passkeys}
    <section aria-labelledby="passkeys" class="flex flex-col gap-4">
      <h2 id="passkeys" tabindex="-1" bind:this={passkeysHeading} class="text-lg font-semibold">
        {m['security.passkeys']()}
      </h2>
      <p>{m['security.passkeys-intro']()}</p>
      {#if data.passkeys.list.length > 0}
        <ul aria-labelledby="passkeys" class="flex flex-col divide-y rounded-lg border">
          {#each data.passkeys.list as passkey (passkey.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 p-4">
              <div id="passkey-{passkey.id}">
                <p class="font-medium">{name(passkey)}</p>
                <p class="text-sm text-muted-foreground">{added(passkey.daysSinceAdded)}</p>
              </div>
              {#if data.passkeys.changeable}
                <form
                  method="POST"
                  action="?/removePasskey"
                  use:enhance={keepFocusOn(() => passkeysHeading)}
                >
                  <input type="hidden" name="passkey" value={passkey.id} />
                  <Button type="submit" variant="outline" aria-describedby="passkey-{passkey.id}">
                    {m['security.remove-passkey']()}
                  </Button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p>{m['security.no-passkeys']()}</p>
      {/if}
      {#if !data.passkeys.changeable}
        <!-- Changing a way of signing in needs a recent sign-in (ADR-0010 §6). -->
        <form method="POST" action="?/confirm" use:enhance class="flex flex-col gap-4">
          <h3 class="font-semibold">{m['security.confirm']()}</h3>
          <p id="confirm-intro">{m['security.confirm-intro']()}</p>
          {#key form}
            {#if confirmProblem}
              <ErrorSummary heading={m['security.confirm-failed']()} message={confirmProblem} />
            {/if}
          {/key}
          <div class="flex flex-col gap-2">
            <Label for="confirm-password">{m['security.confirm-password']()}</Label>
            <Input
              id="confirm-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              aria-describedby="confirm-intro"
            />
          </div>
          <Button type="submit">{m['security.confirm-submit']()}</Button>
        </form>
      {:else if passkeys.supported}
        <Button type="button" onclick={passkeys.add}>{m['security.add-passkey']()}</Button>
      {/if}
      <p role="status">{passkeysStatus}</p>
    </section>
  {/if}
</main>
