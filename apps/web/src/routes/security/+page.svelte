<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let heading = $state<HTMLElement>();

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

  /** What the last change did, for the status message (UI-12). */
  const status = $derived.by(() => {
    if (form?.done === 'signed-out') return m['security.signed-out']();
    if (form?.done === 'signed-out-others') return m['security.signed-out-others']();
    if (form?.done === 'not-found') return m['security.not-found']();
    return '';
  });

  // The button that was pressed leaves with its device, so the focus goes to the list's heading
  // rather than to the top of the page.
  const keepFocus: SubmitFunction =
    () =>
    async ({ update }) => {
      await update();
      heading?.focus();
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
</main>
