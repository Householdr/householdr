<script lang="ts">
  /**
   * A QR code drawn from its modules: one path of `size` × `size` squares, named by `label` for
   * screen readers. It stays dark on light in the dark theme too, since not every scanner reads a
   * QR code the other way round.
   */
  let { size, path, label }: { size: number; path: string; label: string } = $props();
</script>

<svg
  viewBox="0 0 {size} {size}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
  class="h-auto w-56 max-w-full rounded-md"
>
  <rect width={size} height={size} class="fill-white" />
  <path d={path} class="fill-black" />
</svg>
