<script lang="ts">
  /**
   * Why a field wasn't accepted, next to it (UI-10). The field points to it with
   * `aria-describedby`, by `id`; nothing shows while there is no problem.
   */
  let { id, problem }: { id: string; problem: string | undefined } = $props();
</script>

{#if problem}
  <p {id} class="text-sm text-destructive">{problem}</p>
{/if}
