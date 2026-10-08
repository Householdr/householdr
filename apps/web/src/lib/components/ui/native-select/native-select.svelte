<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js';
  import type { HTMLSelectAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    children,
    ...restProps
  }: WithElementRef<
    // The attributes' `value` is typed `any`; a select holds its chosen option's value.
    Omit<HTMLSelectAttributes, 'value'> & { value?: string | null },
    HTMLSelectElement
  > = $props();
</script>

<!-- Adapted from shadcn-svelte (UI-3): the browser's own arrow rather than an icon, 44 px high
     (UI-8), logical padding (UI-17), the input's text size and focus ring, and no smaller size. -->
<div
  class={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', className)}
  data-slot="native-select-wrapper"
>
  <select
    bind:value
    bind:this={ref}
    data-slot="native-select"
    class="h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
    {...restProps}
  >
    {@render children?.()}
  </select>
</div>
