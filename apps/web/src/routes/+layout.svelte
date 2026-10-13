<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { usePageTransitions } from '#lib/hooks/use-page-transitions.svelte.js';
  import { m } from '../lib/paraglide/messages.js';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  usePageTransitions(() => data.flags['page-transitions']);
</script>

<svelte:head>
  <title>{m['app.name']()}</title>
</svelte:head>

{@render children()}
