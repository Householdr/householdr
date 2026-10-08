<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldProblem from '#lib/components/FieldProblem.svelte';
  import QrCode from '#lib/components/QrCode.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { usePasskeys } from '#lib/hooks/use-passkeys.svelte.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let heading = $state<HTMLElement>();
  let passkeysHeading = $state<HTMLElement>();
  let twoFactorHeading = $state<HTMLElement>();
  let setupHeading = $state<HTMLElement>();
  let codesHeading = $state<HTMLElement>();
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
    if (passkeys.outcome === 'not-added') return m['security.passkey-failed']();
    if (form?.done === 'passkey-removed') return m['security.passkey-removed']();
    if (form?.done === 'passkey-not-found') return m['security.passkey-not-found']();
    return '';
  });

  /** Whether ways of signing in can change here: some are offered, and not just yet. */
  const confirming = $derived((data.passkeys || data.twoFactor) && !data.changeable);

  /** Why confirming it's you didn't work, in words (CODE-13). */
  const confirmProblem = $derived.by(() => {
    if (passkeys.outcome === 'not-signed') return m['security.passkey-confirm-failed']();
    if (!form?.confirm) return undefined;
    if (form.confirm === 'incorrect-code') return m['security.incorrect-code']();
    if (form.confirm !== 'wait') return m['security.incorrect-password']();
    const { seconds } = form;
    return seconds < 60
      ? m['sign-in.wait-seconds']({ count: seconds })
      : m['sign-in.wait-minutes']({ count: Math.ceil(seconds / 60) });
  });

  /** The app's setup, while turning two-factor on: after starting, or after a wrong code. */
  const setup = $derived(form?.setup);
  /** The recovery codes, shown once: after turning two-factor on, or making new ones. */
  const recoveryCodes = $derived(form?.recoveryCodes);

  /** The setup key in groups of four, easier to read and type; apps ignore the spaces. */
  const groupsOfFour = /.{1,4}/g;
  const grouped = (key: string) => key.match(groupsOfFour)?.join(' ') ?? key;

  /** Why the last change to two-factor didn't work, in words (CODE-13). */
  const twoFactorProblem = $derived.by(() => {
    switch (form?.twoFactor) {
      case 'incorrect':
        return m['security.setup-incorrect']();
      case 'not-started':
        return m['security.setup-not-started']();
      case 'unavailable':
        return m['security.two-factor-unavailable']();
      case 'head':
        return m['security.two-factor-head']();
      case 'off':
        return m['security.two-factor-already-off']();
      default:
        return undefined;
    }
  });

  /** Two-factor's state, and what the last change to it did, for its status message (UI-12). */
  const twoFactorStatus = $derived.by(() => {
    if (form?.twoFactor === 'new-codes') return m['security.recovery-codes-made']();
    return data.twoFactor?.on ? m['security.two-factor-on']() : m['security.two-factor-off']();
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

  // A change to two-factor shows what comes next, and the focus goes to its heading; a refusal's
  // summary takes the focus itself.
  const focusOnSuccess =
    (target: () => HTMLElement | undefined): SubmitFunction =>
    () =>
    async ({ result, update }) => {
      passkeys.clear();
      await update();
      await tick();
      if (result.type === 'success') target()?.focus();
    };

  /** Confirms it's you with one of the account's passkeys, then shows the page again. */
  async function confirmWithPasskey() {
    if (await passkeys.sign('/security/passkeys/confirm')) {
      await goto('/security?confirmed', { invalidateAll: true });
    }
  }

  /** A password sent to confirm it's you replaces what a passkey's failure said. */
  const confirmWithPassword: SubmitFunction = () => {
    passkeys.clear();
  };
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

  {#if data.passkeys || data.twoFactor}
    <!-- Takes no room while empty, but stays in place to be announced (UI-12). -->
    <p role="status" class="empty:-mb-6">
      {data.confirmed && data.changeable ? m['security.confirmed']() : ''}
    </p>
  {/if}

  {#if confirming}
    <!-- Changing a way of signing in needs a recent sign-in (ADR-0010 §6). -->
    <section aria-labelledby="confirm" class="flex flex-col gap-4">
      <h2 id="confirm" class="text-lg font-semibold">{m['security.confirm']()}</h2>
      <p id="confirm-intro">{m['security.confirm-intro']()}</p>
      {#key form}
        {#key passkeys.attempts}
          {#if confirmProblem}
            <ErrorSummary heading={m['security.confirm-failed']()} message={confirmProblem} />
          {/if}
        {/key}
      {/key}
      {#if data.passkeys && data.passkeys.length > 0 && passkeys.supported}
        <Button type="button" variant="outline" onclick={confirmWithPasskey}>
          {m['security.confirm-passkey']()}
        </Button>
      {/if}
      <form
        method="POST"
        action="?/confirm"
        use:enhance={confirmWithPassword}
        class="flex flex-col gap-4"
      >
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
        {#if data.confirmWithCode}
          <div class="flex flex-col gap-2">
            <Label for="confirm-code">{m['security.confirm-code']()}</Label>
            <Input
              id="confirm-code"
              name="code"
              autocomplete="one-time-code"
              inputmode="numeric"
              required
            />
          </div>
        {/if}
        <Button type="submit">{m['security.confirm-submit']()}</Button>
      </form>
    </section>
  {/if}

  {#if data.passkeys}
    <section aria-labelledby="passkeys" class="flex flex-col gap-4">
      <h2 id="passkeys" tabindex="-1" bind:this={passkeysHeading} class="text-lg font-semibold">
        {m['security.passkeys']()}
      </h2>
      <p>{m['security.passkeys-intro']()}</p>
      {#if data.passkeys.length > 0}
        <ul aria-labelledby="passkeys" class="flex flex-col divide-y rounded-lg border">
          {#each data.passkeys as passkey (passkey.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 p-4">
              <div id="passkey-{passkey.id}">
                <p class="font-medium">{name(passkey)}</p>
                <p class="text-sm text-muted-foreground">{added(passkey.daysSinceAdded)}</p>
              </div>
              {#if data.changeable}
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
      {#if data.changeable && passkeys.supported}
        <Button type="button" onclick={passkeys.add}>{m['security.add-passkey']()}</Button>
      {/if}
      <p role="status">{passkeysStatus}</p>
    </section>
  {/if}

  {#if data.twoFactor}
    <section aria-labelledby="two-factor" class="flex flex-col gap-4">
      <h2 id="two-factor" tabindex="-1" bind:this={twoFactorHeading} class="text-lg font-semibold">
        {m['security.two-factor']()}
      </h2>
      <p>{m['security.two-factor-intro']()}</p>
      <p role="status">{twoFactorStatus}</p>
      {#key form}
        {#if twoFactorProblem}
          <ErrorSummary
            heading={m['security.two-factor-failed']()}
            message={twoFactorProblem}
            fields={form?.twoFactor === 'incorrect'
              ? [{ id: 'setup-code', problem: twoFactorProblem }]
              : []}
          />
        {/if}
      {/key}
      {#if recoveryCodes}
        <h3 id="recovery-codes" tabindex="-1" bind:this={codesHeading} class="font-semibold">
          {m['security.recovery-codes']()}
        </h3>
        <p>{m['security.recovery-codes-intro']()}</p>
        <ul
          aria-labelledby="recovery-codes"
          class="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-4 font-mono"
        >
          {#each recoveryCodes as code (code)}
            <li>{code}</li>
          {/each}
        </ul>
        <p><a href="/security" class="underline">{m['security.recovery-codes-done']()}</a></p>
      {:else if setup}
        <h3 id="setup" tabindex="-1" bind:this={setupHeading} class="font-semibold">
          {m['security.setup']()}
        </h3>
        <ol class="flex list-decimal flex-col gap-4 ps-5">
          <li>
            <div class="flex flex-col gap-2">
              <p>{m['security.setup-scan']()}</p>
              <QrCode size={setup.qr.size} path={setup.qr.path} label={m['security.setup-qr']()} />
            </div>
          </li>
          <li>
            <div class="flex flex-col gap-2">
              <p>{m['security.setup-key']()}</p>
              <p><code class="font-mono">{grouped(setup.key)}</code></p>
            </div>
          </li>
          <li>
            <form
              method="POST"
              action="?/finishTwoFactor"
              use:enhance={focusOnSuccess(() => codesHeading)}
              class="flex flex-col gap-4"
            >
              <div class="flex flex-col gap-2">
                <Label for="setup-code">{m['security.setup-code']()}</Label>
                <Input
                  id="setup-code"
                  name="code"
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  required
                  aria-invalid={form?.twoFactor === 'incorrect' || undefined}
                  aria-describedby={form?.twoFactor === 'incorrect'
                    ? 'setup-code-hint setup-code-problem'
                    : 'setup-code-hint'}
                />
                <p id="setup-code-hint" class="text-sm text-muted-foreground">
                  {m['security.setup-code-hint']()}
                </p>
                <FieldProblem
                  id="setup-code-problem"
                  problem={form?.twoFactor === 'incorrect' ? twoFactorProblem : undefined}
                />
              </div>
              <Button type="submit">{m['security.setup-submit']()}</Button>
            </form>
          </li>
        </ol>
      {:else if data.changeable && data.twoFactor.on}
        <form
          method="POST"
          action="?/newRecoveryCodes"
          use:enhance={focusOnSuccess(() => codesHeading)}
        >
          <Button type="submit" variant="outline">{m['security.new-recovery-codes']()}</Button>
        </form>
        <form
          method="POST"
          action="?/turnOffTwoFactor"
          use:enhance={focusOnSuccess(() => twoFactorHeading)}
        >
          <Button type="submit" variant="outline">{m['security.turn-off']()}</Button>
        </form>
      {:else if data.changeable}
        <form
          method="POST"
          action="?/startTwoFactor"
          use:enhance={focusOnSuccess(() => setupHeading)}
        >
          <Button type="submit">{m['security.turn-on']()}</Button>
        </form>
      {/if}
    </section>
  {/if}
</main>
