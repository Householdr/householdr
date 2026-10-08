<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '../lib/paraglide/messages.js';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <title>{m['app.name']()}</title>
</svelte:head>

{@render children()}
