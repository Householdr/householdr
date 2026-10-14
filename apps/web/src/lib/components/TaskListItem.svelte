<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { Snippet } from 'svelte';

  /**
   * A task in the household's list (ADR-0001 §1): its name, its details as `children`, and, for a
   * head who `mayChange` tasks, a link to its page.
   */
  let {
    id,
    name,
    household,
    mayChange,
    children,
  }: {
    id: string;
    name: string;
    /** The household's id, in the link to the task's page. */
    household: string | undefined;
    mayChange: boolean;
    children: Snippet;
  } = $props();
</script>

<li class="flex flex-col gap-2 p-4">
  <span id="task-{id}" class="font-medium wrap-break-word">{name}</span>
  {@render children()}
  {#if mayChange}
    <!-- Named with its task, as one of many such links (WCAG 2.4.4). -->
    <Button
      id="edit-{id}"
      href="/households/{household}/tasks/{id}"
      variant="outline"
      class="self-start"
      aria-labelledby="edit-{id} task-{id}"
    >
      {m['tasks.edit']()}
    </Button>
  {/if}
</li>
