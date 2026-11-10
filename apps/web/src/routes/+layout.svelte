<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { useHydrationMark } from '#lib/hooks/use-hydration-mark.svelte.js';
  import { usePageTransitions } from '#lib/hooks/use-page-transitions.svelte.js';
  import { m } from '../lib/paraglide/messages.js';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  usePageTransitions(() => data.flags['page-transitions']);
  useHydrationMark();
</script>

<svelte:head>
  <title>{m['app.name']()}</title>
</svelte:head>

{@render children()}
