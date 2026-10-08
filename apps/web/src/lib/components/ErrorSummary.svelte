<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  /**
   * Why a form didn't go through, at its top (UI-10, ADR-0011 §6). It takes the focus when it
   * appears, so a screen reader reads it out and the next Tab carries on from there. Each of the
   * `fields` that need changing links to its control, by the control's id.
   */
  let {
    heading,
    message,
    fields = [],
  }: { heading: string; message: string; fields?: { id: string; problem: string }[] } = $props();
  const id = $props.id();
  const focus: Attachment<HTMLElement> = (summary) => {
    summary.focus();
  };
</script>

<!-- Moving the focus here is what UI-10 asks for: `autofocus` when the page loads with the summary,
     as it does without JavaScript, and `focus()` when it appears in a page already open. -->
<!-- svelte-ignore a11y_autofocus -->
<section
  aria-labelledby={id}
  tabindex="-1"
  autofocus
  {@attach focus}
  class="rounded-lg border-2 border-destructive p-4 wrap-break-word"
>
  <h2 {id} class="font-semibold text-destructive">{heading}</h2>
  <p class="mt-1">{message}</p>
  {#if fields.length > 0}
    <ul class="mt-2 flex list-disc flex-col gap-1 ps-5">
      {#each fields as field (field.id)}
        <li><a href="#{field.id}" class="underline">{field.problem}</a></li>
      {/each}
    </ul>
  {/if}
</section>
