/** Which way a navigation moves: deeper, back up, or across (ADR-0008 §7, clarification). */
export type Direction = 'deeper' | 'shallower' | null;

/** How deep a page is: the number of its path's segments. */
const depthOf = (url: URL) => url.pathname.split('/').filter(Boolean).length;

/**
 * Which way going from `from` to `to` moves, by the depth of their paths: a deeper page comes in
 * over this one, a shallower one is left when this one slides off, and nothing moves between pages
 * at the same depth, a page and itself included.
 */
export function directionOf(from: URL, to: URL): Direction {
  const [before, after] = [depthOf(from), depthOf(to)];
  if (after > before) return 'deeper';
  if (after < before) return 'shallower';
  return null;
}
